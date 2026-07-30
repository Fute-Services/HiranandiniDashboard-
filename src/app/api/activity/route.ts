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

/**
 * Seed data so the admin/manager Session Reports dashboard has something to
 * show on a fresh server start instead of a blank screen — this is a demo
 * app with no DB, so "empty until real staff log in" would otherwise be the
 * default. Only ever generated once, when the in-memory store is first
 * created; real events append on top of it exactly like any other event.
 */
function seedActivity(): ActivityEvent[] {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const staff = [
    { email: "staff@hiranandani.com", name: "Sales Staff", managerEmail: "manager@hiranandani.com" },
    { email: "aditya@hiranandani.com", name: "Aditya Rane", managerEmail: "manager@hiranandani.com" },
    { email: "sneha@hiranandani.com", name: "Sneha Iyer", managerEmail: "manager@hiranandani.com" },
  ];
  const leads = [
    { leadId: "LEAD-1001", leadName: "Rohan Mehta", project: "The Arena" },
    { leadId: "LEAD-1002", leadName: "Priya Nair", project: "Elena" },
    { leadId: "LEAD-1003", leadName: "Arjun & Kavita Shah", project: "Golden Willows" },
    { leadId: "LEAD-1004", leadName: "Sameer Deshpande", project: "Ebony" },
    { leadId: "LEAD-1005", leadName: "Fatima Sheikh", project: "Club House" },
  ];

  const events: ActivityEvent[] = [];
  let idCounter = 0;
  const push = (
    at: number,
    staffIdx: number,
    leadIdx: number | null,
    type: ActivityType,
    label: string,
    durationMs: number | null,
  ) => {
    const s = staff[staffIdx];
    const lead = leadIdx === null ? null : leads[leadIdx];
    events.push({
      id: `seed-${idCounter++}`,
      sessionId: `seed-session-${staffIdx}-${leadIdx ?? "x"}-${at}`,
      staffEmail: s.email,
      staffName: s.name,
      managerEmail: s.managerEmail,
      leadId: lead?.leadId ?? null,
      leadName: lead?.leadName ?? null,
      type,
      label,
      at,
      durationMs,
      device: "Seed Data",
      location: "Mumbai, IN",
    });
  };

  // Three staff x two presentations each, spread over the last five days.
  const sessionPlan: Array<{ staffIdx: number; leadIdx: number; daysAgo: number; startHour: number }> = [
    { staffIdx: 0, leadIdx: 0, daysAgo: 4, startHour: 11 },
    { staffIdx: 0, leadIdx: 2, daysAgo: 1, startHour: 16 },
    { staffIdx: 1, leadIdx: 1, daysAgo: 3, startHour: 10 },
    { staffIdx: 1, leadIdx: 4, daysAgo: 0, startHour: 14 },
    { staffIdx: 2, leadIdx: 3, daysAgo: 2, startHour: 12 },
    { staffIdx: 2, leadIdx: 1, daysAgo: 0, startHour: 17 },
  ];

  for (const { staffIdx, leadIdx, daysAgo, startHour } of sessionPlan) {
    const lead = leads[leadIdx];
    let t = now - daysAgo * day - (24 - startHour) * 60 * 60 * 1000;
    const step = (ms: number) => {
      t += ms;
      return t;
    };
    push(t, staffIdx, null, "login", `${staff[staffIdx].name} signed in`, null);
    push(step(20_000), staffIdx, null, "search", `Searched lead ${lead.leadId}`, null);
    push(step(15_000), staffIdx, leadIdx, "customer_profile", `Opened profile for ${lead.leadName}`, null);
    push(step(90_000), staffIdx, leadIdx, "project_open", `Opened ${lead.project}`, 90_000);
    push(step(120_000), staffIdx, leadIdx, "floor_plan", `Viewed floor plans, ${lead.project}`, 120_000);
    push(step(75_000), staffIdx, leadIdx, "gallery", `Browsed gallery, ${lead.project}`, 75_000);
    push(step(45_000), staffIdx, leadIdx, "amenities", `Viewed amenities, ${lead.project}`, 45_000);
    push(step(30_000), staffIdx, leadIdx, "brochure_download", `Downloaded brochure, ${lead.project}`, null);
    push(step(10_000), staffIdx, leadIdx, "notes", `Added notes for ${lead.leadName}`, null);
    push(step(5_000), staffIdx, leadIdx, "status", `Marked ${lead.leadName} as Follow-up`, null);
    push(step(8_000), staffIdx, null, "logout", `${staff[staffIdx].name} signed out`, null);
  }

  return events.sort((a, b) => a.at - b.at);
}

const store = globalThis.__hiranandaniActivity ?? (globalThis.__hiranandaniActivity = seedActivity());

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
