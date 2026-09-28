import { Router } from "express";
import { findUserByEmail as findStoredUser } from "../lib/store.js";
import { withJsonErrors } from "../lib/api.js";
import { isSameOrigin } from "../lib/csrf.js";
import { checkRateLimit, clientKey } from "../lib/rate-limit.js";
import { getViewer } from "../lib/viewer.js";
import { USERS } from "../lib/users.js";
import { DEVICE_TYPES } from "../../src/lib/device-types.js";
import { recordDeviceUsage } from "../lib/sperto-device-usage.js";

/**
 * Fires Sperto's device-usage call (server/lib/sperto-device-usage.js) for the
 * signed-in staff member. The api_key stays server-side, so the client only
 * ever posts here, never straight to Sperto.
 *
 * - **IN** goes once the staff member has entered their Sales ID, the Lead ID
 *   and picked the device (src/lib/session.js's startPresentation). It is a
 *   gate: Sperto checks the Sales ID and Lead ID, and the presentation only
 *   starts if it answers success. Anything else comes back as an error the
 *   screen shows.
 * - **OUT** goes at sign-out with the per-project minutes in page_url
 *   (finalizeSession). Best-effort: the presentation is already over, so
 *   whatever Sperto says is logged, not surfaced.
 */
export const deviceUsageRouter = Router();

/**
 * `page_url` carries two different things depending on the call, and both
 * arrive from a browser, so both are shape rather than data until this has
 * been through them:
 *
 * - On "OUT": the presentation's per-project minutes (two decimals), one
 *   object per project — `[{ "Elena": 3 }, { "Alibaug": 4.5 }]`. This is the only field the
 *   times go out in; nothing is sent alongside it.
 * - On "IN": nothing has been opened yet, so it keeps the field's original
 *   meaning — the page the session started on, as a string.
 *
 * Entries that aren't a single project name against a finite positive number
 * are dropped: a `0` in particular reads as a visit that happened, which is
 * the same rule src/lib/project-time.js keeps on the way out.
 *
 * Capped at 50 entries. A real presentation opens a handful of projects, and
 * an unbounded array from a browser is an unbounded write into the client's
 * CRM.
 */
function sanitizePageUrl(input, fallbackUrl) {
  if (typeof input === "string") return input.trim() || fallbackUrl;
  if (!Array.isArray(input)) return fallbackUrl;

  const out = [];
  for (const entry of input.slice(0, 50)) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const clean = {};
    for (const [project, minutes] of Object.entries(entry)) {
      const name = project.trim();
      if (!name) continue;
      if (typeof minutes !== "number" || !Number.isFinite(minutes)) continue;
      // Two decimals, the same rounding src/lib/project-time.js applies —
      // Math.round here would turn 0.75 into 1 and 0.25 into a dropped entry.
      const rounded = Math.round(minutes * 100) / 100;
      if (rounded <= 0) continue;
      clean[name] = rounded;
    }
    if (Object.keys(clean).length > 0) out.push(clean);
  }
  // Never empty — it is their field and has always carried something.
  return out.length > 0 ? out : fallbackUrl;
}

/** The account's Sperto Sales ID — the static roster first, then the
 * admin-created accounts in the API's in-memory store (see lib/store.js),
 * the same split routes/login.js uses. Null when nobody has put one on file,
 * which the caller treats as "nothing to report to Sperto" rather than an
 * error. */
function spertoLoginFor(email) {
  const staticUser = USERS.find((u) => u.email === email);
  if (staticUser) return staticUser.spertoLogin ?? null;
  const stored = findStoredUser(email);
  if (stored) return stored.spertoLogin ?? null;
  // Signed in by a Sales ID Sperto vouched for and we have no account for
  // (routes/login.js): the session runs under the Sales ID itself, which is
  // exactly the sales_manager_login this call needs.
  return email.includes("@") ? null : email;
}

deviceUsageRouter.post(
  "/",
  withJsonErrors(async (req, res) => {
    if (!isSameOrigin(req)) {
      return res.status(403).json({ error: "Invalid origin" });
    }
    // Per-IP, and a showroom's whole floor is behind one of them: every
    // device sends an IN and an OUT per presentation, so 60 a minute is a
    // ceiling a busy morning can actually reach, and reaching it would drop
    // a real visit's times rather than stop an abuser. 300 is the same figure
    // the other office-shared routes use.
    if (!checkRateLimit(`device-usage:${clientKey(req)}`, 300, 60_000)) {
      return res.status(429).json({ error: "Too many requests" });
    }

    const viewer = await getViewer(req);
    if (!viewer) return res.status(401).json({ error: "Not signed in" });

    const { leadId, deviceType, type, pageUrl } = req.body ?? {};

    if (type !== "IN" && type !== "OUT") {
      return res.status(400).json({ error: "type (IN/OUT) required" });
    }
    if (leadId != null && typeof leadId !== "string") {
      return res.status(400).json({ error: "Invalid leadId" });
    }
    if (deviceType != null && !DEVICE_TYPES.includes(deviceType)) {
      return res.status(400).json({ error: "Invalid deviceType" });
    }
    if (type === "IN" && (!leadId?.trim() || !deviceType)) {
      return res.status(400).json({ error: "Lead ID and device are required." });
    }

    // IN's page_url is Sperto's own site, as in their documented example
    // ("https://net4hgc.sperto.co.in"); OUT's carries the project minutes.
    const ownOrigin = `${req.protocol}://${req.get("host")}`;
    const spertoSite = process.env.SPERTO_BASE_URL?.trim()
      .replace(/\/+$/, "")
      .replace(/\/_api$/, "");
    const cleanPageUrl =
      type === "IN" ? spertoSite || ownOrigin : sanitizePageUrl(pageUrl, ownOrigin);

    // The Sales ID captured at sign-in first; the roster only for sessions
    // signed before the token carried one.
    const salesManagerLogin = viewer.spertoLogin || spertoLoginFor(viewer.email);
    if (!salesManagerLogin) {
      // Not silent: the login route already logged which fields Sperto's
      // answer had, and this is where the missing visit would otherwise vanish.
      console.warn(
        `[device-usage] ${type} for ${viewer.email} not sent: no Sales ID known for this session`,
      );
      if (type === "IN") {
        return res
          .status(400)
          .json({ error: "No Sales ID on this sign-in. Log out and sign in with your Sales ID." });
      }
      return res.json({ ok: true, recorded: false, skipped: "no sperto login on file" });
    }

    const outcome = await recordDeviceUsage({
      deviceType: deviceType ?? null,
      leadId: leadId?.trim() ?? "",
      salesManagerLogin,
      type,
      pageUrl: cleanPageUrl,
    });

    // IN is the gate: only Sperto's success lets the presentation start.
    if (type === "IN" && !outcome.ok) {
      if (outcome.reason === "rejected") {
        return res
          .status(422)
          .json({ error: outcome.message || "Sperto did not accept this Sales ID / Lead ID." });
      }
      return res.status(502).json({ error: outcome.message || "Could not reach Sperto. Try again." });
    }

    // OUT: still 200 whatever Sperto said — the presentation has ended and
    // the client has already navigated away. `recorded` says what happened,
    // so the log can tell a stored visit from a dropped one.
    return res.json({
      ok: true,
      recorded: outcome.ok,
      ...(outcome.ok ? {} : { reason: outcome.reason }),
    });
  }),
);
