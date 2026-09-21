import { randomUUID } from "node:crypto";
import { Router } from "express";
import { getSql, hasDb } from "../lib/db.js";
import { withJsonErrors } from "../lib/api.js";
import { isSameOrigin } from "../lib/csrf.js";
import { checkRateLimit, clientKey } from "../lib/rate-limit.js";
import { appendEvent, eventCount, listEvents, storageKind } from "../lib/activity-store.js";

/** Hard cap so a single response can never grow unbounded as history piles
 * up over weeks/months — applied regardless of which filters are set,
 * including "All Time". Ordered by most-recent-first before the cap so a
 * truncated result is still the most useful slice. */
const MAX_ROWS = 5000;

/**
 * Append-only activity log: every login, search, and project/property
 * interaction a sales staff member generates (the "Admin & Sales Manager
 * Activity Tracking" goal). This route only ever GETs or POSTs a new entry —
 * there is deliberately no PATCH/DELETE handler, so sales staff have no path
 * to edit or erase their own history.
 *
 * Two backends, same shape. With `DATABASE_URL` set it is Postgres (see
 * scripts/db/schema.sql — `activity_events`, seeded via scripts/db/seed.mjs).
 * Without it — the app's normal configuration, since the whole staff flow is
 * designed to run with no database and no credentials — it is the
 * server-side file store in `server/lib/activity-store.js`. Neither the
 * client nor the dashboards can tell the difference; only `GET ?storage=1`
 * reports which one is live.
 *
 * It used to be Postgres or nothing: no database meant every POST was
 * answered `{ ok: true }` and discarded, and every GET answered `[]`, so a
 * whole walkthrough looked recorded from the browser and was in fact never
 * written anywhere.
 */
export const activityRouter = Router();

function toEvent(r) {
  return {
    id: r.id,
    sessionId: r.session_id,
    staffEmail: r.staff_email,
    staffName: r.staff_name,
    managerEmail: r.manager_email,
    leadId: r.lead_id,
    leadName: r.lead_name,
    type: r.type,
    label: r.label,
    at: Number(r.at),
    durationMs: r.duration_ms === null ? null : Number(r.duration_ms),
    device: r.device,
    location: r.location,
  };
}

function locationFromHeaders(req) {
  const city = req.get("x-vercel-ip-city");
  const country = req.get("x-vercel-ip-country");
  if (!city && !country) return null;
  return [city, country].filter(Boolean).join(", ");
}

activityRouter.post(
  "/",
  withJsonErrors(async (req, res) => {
    if (!isSameOrigin(req)) {
      return res.status(403).json({ error: "Invalid origin" });
    }
    // Per-IP only (no per-account dimension here, unlike login) — kept loose
    // for the same reason: many staff behind one shared/office IP, each firing
    // an event per click, adds up fast under real concurrent use.
    if (!checkRateLimit(`activity:${clientKey(req)}`, 600, 60_000)) {
      return res.status(429).json({ error: "Too many requests" });
    }

    const body = req.body ?? {};
    if (!body.sessionId || !body.staffEmail || !body.type) {
      return res.status(400).json({ error: "sessionId, staffEmail, type required" });
    }

    const event = {
      id: randomUUID(),
      sessionId: body.sessionId,
      staffEmail: body.staffEmail,
      staffName: body.staffName ?? body.staffEmail,
      managerEmail: body.managerEmail ?? null,
      leadId: body.leadId ?? null,
      leadName: body.leadName ?? null,
      type: body.type,
      label: body.label ?? body.type,
      at: Date.now(),
      durationMs: body.durationMs ?? null,
      device: body.device ?? null,
      location: locationFromHeaders(req),
    };

    // No DB configured is the ordinary case, not a degraded one: the event
    // goes to the server-side file store instead. Same append-only contract,
    // same event, no credentials needed.
    if (!hasDb()) {
      appendEvent(event);
      return res.json({ ok: true, id: event.id });
    }

    const sql = getSql();
    await sql`
      INSERT INTO activity_events
        (id, session_id, staff_email, staff_name, manager_email, lead_id, lead_name, type, label, at, duration_ms, device, location)
      VALUES
        (${event.id}, ${event.sessionId}, ${event.staffEmail}, ${event.staffName}, ${event.managerEmail},
         ${event.leadId}, ${event.leadName}, ${event.type}, ${event.label}, ${event.at}, ${event.durationMs},
         ${event.device}, ${event.location})
    `;

    return res.json({ ok: true, id: event.id });
  }),
);

activityRouter.get(
  "/",
  withJsonErrors(async (req, res) => {
    const params = req.query;
    const managerEmail = params.managerEmail ?? null;
    const staffEmail = params.staffEmail ?? null;
    const leadId = params.leadId ?? null;
    const project = params.project ? String(params.project).toLowerCase() : null;
    const from = params.from ? Number(params.from) : null;
    const to = params.to ? Number(params.to) : null;

    // Diagnostic, not part of the log: answers "where is this actually being
    // written, and has anything landed?" without anyone having to find the
    // file. Deliberately reports the same for both backends.
    if (params.storage) {
      return res.json({
        backend: hasDb() ? "postgres" : storageKind(),
        count: hasDb() ? null : eventCount(),
      });
    }

    if (!hasDb()) {
      return res.json(listEvents({ managerEmail, staffEmail, leadId, project, from, to }));
    }

    const conditions = [];
    const values = [];
    const add = (clause, value) => {
      values.push(value);
      conditions.push(clause.replace("?", `$${values.length}`));
    };

    if (managerEmail) add("manager_email = ?", managerEmail);
    if (staffEmail) add("staff_email = ?", staffEmail);
    if (leadId) add("lead_id = ?", leadId);
    if (project) {
      values.push(`%${project}%`);
      const i = values.length;
      conditions.push(`(lower(label) LIKE $${i} OR lower(coalesce(lead_name, '')) LIKE $${i})`);
    }
    if (from !== null) add("at >= ?", from);
    if (to !== null) add("at <= ?", to);

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const sql = getSql();
    const rows = await sql.query(
      `SELECT * FROM (
         SELECT * FROM activity_events ${where} ORDER BY at DESC LIMIT ${MAX_ROWS}
       ) capped ORDER BY at ASC`,
      values,
    );

    return res.json(rows.map(toEvent));
  }),
);
