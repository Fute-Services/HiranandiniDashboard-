import { Router } from "express";
import { getSql, hasDb } from "../lib/db.js";
import { withJsonErrors } from "../lib/api.js";
import { isSameOrigin } from "../lib/csrf.js";
import { checkRateLimit, clientKey } from "../lib/rate-limit.js";

/**
 * Admin/sales-manager controls over sales staff and projects, backed by
 * Postgres (see scripts/db/schema.sql — `staff_controls`). This has to live
 * server-side rather than in localStorage: cookies (who's signed in) and
 * localStorage are both scoped to the same browser profile, so two tabs in
 * one browser can't hold two different signed-in identities at once (logging
 * in as staff in one tab silently logs in that same browser as staff
 * everywhere). A real manager and a real sales-staff member are on separate
 * devices/browsers, so the shared control state needs a channel that isn't
 * tied to a single browser's storage — this route is that channel.
 */
export const controlsRouter = Router();

controlsRouter.get(
  "/",
  withJsonErrors(async (req, res) => {
    const email = req.query.email;
    if (!email) return res.status(400).json({ error: "email required" });
    const sessionId = req.query.sessionId ?? null;

    // No DB configured means nobody's ever been kicked/blocked/suspended —
    // the same "not controlled" defaults a brand-new account gets below.
    if (!hasDb()) {
      return res.json({ kicked: false, blockedProjects: [], loginSuspended: false, sessionInvalid: false });
    }

    const sql = getSql();
    const rows = await sql`
      SELECT kicked, blocked_projects, login_suspended, current_session_id FROM staff_controls WHERE email = ${email}
    `;
    const row = rows[0];

    return res.json({
      kicked: row?.kicked ?? false,
      blockedProjects: row?.blocked_projects ?? [],
      loginSuspended: row?.login_suspended ?? false,
      // Only meaningful once a session has actually been recorded (a fresh
      // account with no `current_session_id` yet shouldn't eject anyone), and
      // only when the caller sent one to compare against.
      sessionInvalid: Boolean(sessionId && row?.current_session_id && row.current_session_id !== sessionId),
    });
  }),
);

controlsRouter.post(
  "/",
  withJsonErrors(async (req, res) => {
    if (!isSameOrigin(req)) {
      return res.status(403).json({ error: "Invalid origin" });
    }
    // Per-IP only, kept loose for the same office-NAT reason as /api/login and
    // /api/activity — this is only admin/manager actions (kick, block), but
    // several managers on one office network shouldn't collide with each other.
    if (!checkRateLimit(`controls:${clientKey(req)}`, 300, 60_000)) {
      return res.status(429).json({ error: "Too many requests" });
    }

    const { action, email, slug } = req.body ?? {};
    if (!email) return res.status(400).json({ error: "email required" });

    const sql = getSql();
    await sql`
      INSERT INTO staff_controls (email, kicked, blocked_projects)
      VALUES (${email}, false, '{}')
      ON CONFLICT (email) DO NOTHING
    `;

    if (action === "kick") {
      // Force logout also suspends login — the staff member is ejected right
      // now AND can't just sign back in a moment later. Only "restore" lifts
      // that, which only an admin/manager can trigger (this whole route is
      // already admin/manager-only surface).
      await sql`UPDATE staff_controls SET kicked = true, login_suspended = true WHERE email = ${email}`;
    } else if (action === "ack") {
      // The kicked staff member's own tab calls this right after it's forced
      // itself to sign out — clears only the transient "eject now" flag, not
      // the persistent suspension, so they still can't log back in.
      await sql`UPDATE staff_controls SET kicked = false WHERE email = ${email}`;
    } else if (action === "restore") {
      await sql`UPDATE staff_controls SET login_suspended = false WHERE email = ${email}`;
    } else if (action === "block" || action === "unblock") {
      if (!slug) return res.status(400).json({ error: "slug required" });
      if (action === "block") {
        await sql`
          UPDATE staff_controls
          SET blocked_projects = array_append(blocked_projects, ${slug})
          WHERE email = ${email} AND NOT (${slug} = ANY(blocked_projects))
        `;
      } else {
        await sql`
          UPDATE staff_controls
          SET blocked_projects = array_remove(blocked_projects, ${slug})
          WHERE email = ${email}
        `;
      }
    } else {
      return res.status(400).json({ error: "unknown action" });
    }

    return res.json({ ok: true });
  }),
);
