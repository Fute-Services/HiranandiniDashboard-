import { Router } from "express";
import { getSql, hasDb } from "../lib/db.js";
import { withJsonErrors } from "../lib/api.js";
import { isSameOrigin } from "../lib/csrf.js";
import { checkRateLimit, clientKey } from "../lib/rate-limit.js";
import { getViewer } from "../lib/viewer.js";
import { USERS } from "../lib/users.js";
import { DEVICE_TYPES } from "../../src/lib/device-types.js";
import { recordDeviceUsage } from "../lib/sperto-device-usage.js";

/**
 * Fires Sperto's device-usage log (server/lib/sperto-device-usage.js) for the
 * signed-in staff member's presentation session — "IN" on start, "OUT" on
 * end (see src/lib/session.js's setActiveSession/finalizeSession). The
 * api_key stays server-side, so the client only ever posts here, never
 * straight to Sperto.
 *
 * Always answers 200/ok even when nothing was actually sent (unconfigured,
 * or the signed-in account has no Sperto login code on file) — this is a
 * best-effort side log, and its outcome must never affect whether a
 * presentation session is allowed to start or end.
 */
export const deviceUsageRouter = Router();

/**
 * The per-project seconds map comes straight off the browser, so it is
 * treated as untrusted shape rather than as the map the client meant to
 * send: anything that isn't a finite positive number under a non-empty key is
 * dropped. A malformed entry costs one project's time in a report; forwarding
 * it verbatim would put whatever the browser said into the client's CRM.
 * Returns undefined when nothing survives, so the outgoing body omits
 * `project_time` entirely rather than sending `{}`.
 */
function sanitizeProjectTime(input) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return undefined;
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    const name = key.trim();
    if (!name) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) continue;
    out[name] = Math.round(value);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * `page_url` carries two different things depending on the call, and both
 * arrive from a browser, so both are shape rather than data until this has
 * been through them:
 *
 * - On "OUT": the presentation's per-project seconds, one object per project
 *   — `[{ "Elena": 180 }, { "Alibaug": 240 }]`. Same content as
 *   `project_time`, which also goes out; whichever field their backend is
 *   actually reading has the numbers in it.
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
    for (const [project, seconds] of Object.entries(entry)) {
      const name = project.trim();
      if (!name) continue;
      if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) continue;
      clean[name] = Math.round(seconds);
    }
    if (Object.keys(clean).length > 0) out.push(clean);
  }
  // Never empty — it is their field and has always carried something.
  return out.length > 0 ? out : fallbackUrl;
}

async function spertoLoginFor(email) {
  const staticUser = USERS.find((u) => u.email === email);
  if (staticUser) return staticUser.spertoLogin ?? null;
  if (!hasDb()) return null;
  const sql = getSql();
  const rows = await sql`SELECT sperto_login FROM users WHERE email = ${email}`;
  return rows[0]?.sperto_login ?? null;
}

deviceUsageRouter.post(
  "/",
  withJsonErrors(async (req, res) => {
    if (!isSameOrigin(req)) {
      return res.status(403).json({ error: "Invalid origin" });
    }
    if (!checkRateLimit(`device-usage:${clientKey(req)}`, 60, 60_000)) {
      return res.status(429).json({ error: "Too many requests" });
    }

    const viewer = await getViewer(req);
    if (!viewer) return res.status(401).json({ error: "Not signed in" });

    const { leadId, deviceType, type, pageUrl, projectTime } = req.body ?? {};

    if (!leadId || (type !== "IN" && type !== "OUT")) {
      return res.status(400).json({ error: "leadId and type (IN/OUT) required" });
    }
    if (deviceType != null && !DEVICE_TYPES.includes(deviceType)) {
      return res.status(400).json({ error: "Invalid deviceType" });
    }

    const cleanProjectTime = sanitizeProjectTime(projectTime);
    const cleanPageUrl = sanitizePageUrl(pageUrl, `${req.protocol}://${req.get("host")}`);

    const salesManagerLogin = await spertoLoginFor(viewer.email);
    if (!salesManagerLogin) {
      return res.json({ ok: true, recorded: false, skipped: "no sperto login on file" });
    }

    const outcome = await recordDeviceUsage({
      deviceType: deviceType ?? null,
      leadId,
      salesManagerLogin,
      type,
      pageUrl: cleanPageUrl,
      projectTime: cleanProjectTime,
    });

    // Still 200, still `ok: true`, whatever Sperto said. This is a
    // best-effort side log: a presentation must be free to start and to end
    // whether or not their CRM accepted the write, and the client that called
    // this has already navigated away by the time an "OUT" answers.
    //
    // `recorded` is the honest part — it is what actually happened, now that
    // the body is read rather than discarded, so a caller (or a log) can tell
    // a stored visit from a silently dropped one instead of seeing `ok: true`
    // for both.
    return res.json({
      ok: true,
      recorded: outcome.ok,
      ...(outcome.ok ? {} : { reason: outcome.reason }),
    });
  }),
);
