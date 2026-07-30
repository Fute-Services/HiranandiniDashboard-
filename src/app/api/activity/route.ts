import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { ActivityEvent, ActivityType } from "@/lib/activity";

/**
 * Append-only activity log: every login, search, and project/property
 * interaction a sales staff member generates (the "Admin & Sales Manager
 * Activity Tracking" goal). In-memory on the dev server, same pattern as
 * `/api/controls` (no DB yet, see that route's comment). This route only
 * ever GETs or POSTs a new entry — there is deliberately no PATCH/DELETE
 * handler, so sales staff have no path to edit or erase their own history;
 * only server restarts clear it.
 */
declare global {
  // eslint-disable-next-line no-var
  var __hiranandaniActivity: ActivityEvent[] | undefined;
}

const store = globalThis.__hiranandaniActivity ?? (globalThis.__hiranandaniActivity = []);

function locationFromHeaders(req: NextRequest): string | null {
  const city = req.headers.get("x-vercel-ip-city");
  const country = req.headers.get("x-vercel-ip-country");
  if (!city && !country) return null;
  return [city, country].filter(Boolean).join(", ");
}

export async function POST(req: NextRequest) {
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
  store.push(event);

  return NextResponse.json({ ok: true, id: event.id });
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const managerEmail = params.get("managerEmail");
  const staffEmail = params.get("staffEmail");
  const leadId = params.get("leadId");
  const project = params.get("project")?.toLowerCase();
  const from = params.get("from") ? Number(params.get("from")) : null;
  const to = params.get("to") ? Number(params.get("to")) : null;

  const filtered = store.filter((e) => {
    if (managerEmail && e.managerEmail !== managerEmail) return false;
    if (staffEmail && e.staffEmail !== staffEmail) return false;
    if (leadId && e.leadId !== leadId) return false;
    if (project && !e.label.toLowerCase().includes(project) && !(e.leadName ?? "").toLowerCase().includes(project))
      return false;
    if (from !== null && e.at < from) return false;
    if (to !== null && e.at > to) return false;
    return true;
  });

  return NextResponse.json([...filtered].sort((a, b) => a.at - b.at));
}
