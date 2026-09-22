import { Router } from "express";
import { getControls, setControls } from "../lib/store.js";
import { withJsonErrors } from "../lib/api.js";
import { isSameOrigin } from "../lib/csrf.js";
import { checkRateLimit, clientKey } from "../lib/rate-limit.js";

/**
 * Admin/sales-manager controls over sales staff and projects, held in the
 * API process's memory (see server/lib/store.js).
 *
 * This is the one piece of state that cannot move into the browser, and the
 * reason is worth keeping: cookies (who's signed in) and web storage are
 * both scoped to a single browser profile, so two tabs in one browser can't
 * hold two different signed-in identities at once. A real manager and a real
 * sales-staff member are on separate devices, so "this staff member has been
 * signed out" has to be readable from a browser other than the one that set
 * it — this route is that channel.
 *
 * Memory, not a database, because nothing here is ours to keep: a restart
 * simply returns every account to the defaults a brand-new one gets, which
 * is the same answer the no-database path always gave.
 */
export const controlsRouter = Router();

controlsRouter.get(
  "/",
  withJsonErrors(async (req, res) => {
    const email = req.query.email;
    if (!email) return res.status(400).json({ error: "email required" });
    const sessionId = req.query.sessionId ?? null;

    const row = getControls(email);

    return res.json({
      kicked: row.kicked,
      blockedProjects: row.blockedProjects,
      loginSuspended: row.loginSuspended,
      // Only meaningful once a session has actually been recorded (a fresh
      // account with no `currentSessionId` yet shouldn't eject anyone), and
      // only when the caller sent one to compare against.
      sessionInvalid: Boolean(sessionId && row.currentSessionId && row.currentSessionId !== sessionId),
    });
  }),
);

controlsRouter.post(
  "/",
  withJsonErrors(async (req, res) => {
    if (!isSameOrigin(req)) {
      return res.status(403).json({ error: "Invalid origin" });
    }
    // Per-IP only, kept loose for the same office-NAT reason as /api/login —
    // this is only admin/manager actions (kick, block), but several managers
    // on one office network shouldn't collide with each other.
    if (!checkRateLimit(`controls:${clientKey(req)}`, 300, 60_000)) {
      return res.status(429).json({ error: "Too many requests" });
    }

    const { action, email, slug } = req.body ?? {};
    if (!email) return res.status(400).json({ error: "email required" });

    if (action === "kick") {
      // Force logout also suspends login — the staff member is ejected right
      // now AND can't just sign back in a moment later. Only "restore" lifts
      // that, which only an admin/manager can trigger (this whole route is
      // already admin/manager-only surface).
      setControls(email, { kicked: true, loginSuspended: true });
    } else if (action === "ack") {
      // The kicked staff member's own tab calls this right after it's forced
      // itself to sign out — clears only the transient "eject now" flag, not
      // the persistent suspension, so they still can't log back in.
      setControls(email, { kicked: false });
    } else if (action === "restore") {
      setControls(email, { loginSuspended: false });
    } else if (action === "block" || action === "unblock") {
      if (!slug) return res.status(400).json({ error: "slug required" });
      const current = getControls(email).blockedProjects;
      // Set semantics either way: blocking an already-blocked project is not
      // an error and must not list it twice, which is what the SQL this
      // replaced spelled out as array_append/array_remove with a guard.
      const blockedProjects =
        action === "block"
          ? current.includes(slug)
            ? current
            : [...current, slug]
          : current.filter((s) => s !== slug);
      setControls(email, { blockedProjects });
    } else {
      return res.status(400).json({ error: "unknown action" });
    }

    return res.json({ ok: true });
  }),
);
