import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSql, hasDb } from "@/lib/db";
import { withJsonErrors } from "@/lib/api";
import { isSameOrigin } from "@/lib/csrf";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";
import type { ActivityEvent, ActivityType } from "@/lib/activity";

/** Hard cap so a single response can never grow unbounded as history piles
 * up over weeks/months — applied regardless of which filters are set,
 * including "All Time". Ordered by most-recent-first before the cap so a
 * truncated result is still the most useful slice. */
const MAX_ROWS = 5000;

/**
 * Append-only activity log: every login, search, and project/property
 * interaction a sales staff member generates (the "Admin & Sales Manager
 * Activity Tracking" goal). Backed by Postgres (see scripts/db/schema.sql —
 * `activity_events`, seeded via scripts/db/seed.mjs). This route only ever
 * GETs or POSTs a new entry — there is deliberately no PATCH/DELETE handler,
 * so sales staff have no path to edit or erase their own history.
 */

type Row = {
  id: string;
  session_id: string;
  staff_email: string;
  staff_name: string;
  manager_email: string | null;
  lead_id: string | null;
  lead_name: string | null;
  type: ActivityType;
  label: string;
  at: string | number;
  duration_ms: string | number | null;
  device: string | null;
  location: string | null;
};

function toEvent(r: Row): ActivityEvent {
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

function locationFromHeaders(req: NextRequest): string | null {
  const city = req.headers.get("x-vercel-ip-city");
  const country = req.headers.get("x-vercel-ip-country");
  if (!city && !country) return null;
  return [city, country].filter(Boolean).join(", ");
}

export const POST = withJsonErrors(async (req: NextRequest) => {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }
  // Per-IP only (no per-account dimension here, unlike login) — kept loose
  // for the same reason: many staff behind one shared/office IP, each firing
  // an event per click, adds up fast under real concurrent use.
  if (!checkRateLimit(`activity:${clientKey(req)}`, 600, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const body = (await req.json()) as Partial<ActivityEvent> & { type: ActivityType };
  if (!body.sessionId || !body.staffEmail || !body.type) {
    return NextResponse.json({ error: "sessionId, staffEmail, type required" }, { status: 400 });
  }

  const event: ActivityEvent = {
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

  // No DB configured means no log to write to — track() is fire-and-forget
  // and the caller never reads this response, same reasoning as the reads
  // below skipping themselves rather than throwing.
  if (!hasDb()) return NextResponse.json({ ok: true, id: event.id });

  const sql = getSql();
  await sql`
    INSERT INTO activity_events
      (id, session_id, staff_email, staff_name, manager_email, lead_id, lead_name, type, label, at, duration_ms, device, location)
    VALUES
      (${event.id}, ${event.sessionId}, ${event.staffEmail}, ${event.staffName}, ${event.managerEmail},
       ${event.leadId}, ${event.leadName}, ${event.type}, ${event.label}, ${event.at}, ${event.durationMs},
       ${event.device}, ${event.location})
  `;

  return NextResponse.json({ ok: true, id: event.id });
});

export const GET = withJsonErrors(async (req: NextRequest) => {
  if (!hasDb()) return NextResponse.json([]);

  const params = req.nextUrl.searchParams;
  const managerEmail = params.get("managerEmail");
  const staffEmail = params.get("staffEmail");
  const leadId = params.get("leadId");
  const project = params.get("project")?.toLowerCase();
  const from = params.get("from") ? Number(params.get("from")) : null;
  const to = params.get("to") ? Number(params.get("to")) : null;

  const conditions: string[] = [];
  const values: unknown[] = [];
  const add = (clause: string, value: unknown) => {
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
  const rows = (await sql.query(
    `SELECT * FROM (
       SELECT * FROM activity_events ${where} ORDER BY at DESC LIMIT ${MAX_ROWS}
     ) capped ORDER BY at ASC`,
    values,
  )) as Row[];

  return NextResponse.json(rows.map(toEvent));
});
