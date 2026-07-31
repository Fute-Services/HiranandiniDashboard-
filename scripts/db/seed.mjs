/**
 * One-time port of the demo data that used to be regenerated in memory on
 * every cold start (src/app/api/activity/route.ts's old seedActivity()).
 * Run once against a fresh database; real events append on top exactly like
 * any other event afterwards.
 */
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL(_UNPOOLED) not set — run with --env-file=.env.local");
const sql = neon(url);

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
  { leadId: "LEAD-1006", leadName: "Ananya Kapoor", project: "Quality" },
];

const events = [];
let idCounter = 0;
function push(sessionId, at, staffIdx, leadIdx, type, label, durationMs) {
  const s = staff[staffIdx];
  const lead = leadIdx === null ? null : leads[leadIdx];
  events.push({
    id: `seed-${idCounter++}`,
    sessionId,
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
}

// Each session uses a distinct leadIdx (0-5) — one client name per session,
// none repeated, matching the 6 unique leads above.
const sessionPlan = [
  { staffIdx: 0, leadIdx: 0, daysAgo: 4, startHour: 11 },
  { staffIdx: 0, leadIdx: 2, daysAgo: 1, startHour: 16 },
  { staffIdx: 1, leadIdx: 1, daysAgo: 3, startHour: 10 },
  { staffIdx: 1, leadIdx: 4, daysAgo: 0, startHour: 14 },
  { staffIdx: 2, leadIdx: 3, daysAgo: 2, startHour: 12 },
  { staffIdx: 2, leadIdx: 5, daysAgo: 0, startHour: 17 },
];

/** Random int in [min, max], inclusive — every seeded duration/gap uses
 * this instead of a fixed constant so demo numbers vary session to
 * session instead of all landing on the same value. */
function randRange(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

// Every session always opens the project and views floor plans (the
// "core" walkthrough); the rest are each independently a coin flip, so
// different sessions show a different mix of content — otherwise every
// session shows exactly the same 5 content types and the Reports charts
// end up all-equal, uninteresting slices.
const OPTIONAL_STEPS = [
  { type: "gallery", label: (p) => `Browsed gallery, ${p}`, chance: 0.75 },
  { type: "amenities", label: (p) => `Viewed amenities, ${p}`, chance: 0.6 },
  { type: "tour_view", label: (p) => `Viewed 360° tour, ${p}`, chance: 0.45 },
  { type: "brochure_download", label: (p) => `Downloaded brochure, ${p}`, chance: 0.55 },
];

for (const { staffIdx, leadIdx, daysAgo, startHour } of sessionPlan) {
  const lead = leads[leadIdx];
  let t = now - daysAgo * day - (24 - startHour) * 60 * 60 * 1000;
  // One fixed id for every event in this session — previously this was
  // rebuilt per-event from the ever-changing `t`, so each session's 8+
  // events landed as 8+ separate one-event "presentations" instead of the
  // single walkthrough they actually are.
  const sessionId = `seed-session-${staffIdx}-${leadIdx}-${t}`;
  const step = (ms) => (t += ms);
  push(sessionId, t, staffIdx, null, "login", `${staff[staffIdx].name} signed in`, null);
  push(sessionId, step(randRange(10_000, 30_000)), staffIdx, null, "search", `Searched lead ${lead.leadId}`, null);
  push(sessionId, step(randRange(8_000, 25_000)), staffIdx, leadIdx, "customer_profile", `Opened profile for ${lead.leadName}`, null);
  push(sessionId, step(randRange(50_000, 150_000)), staffIdx, leadIdx, "project_open", `Opened ${lead.project}`, randRange(50_000, 150_000));
  push(sessionId, step(randRange(45_000, 160_000)), staffIdx, leadIdx, "floor_plan", `Viewed floor plans, ${lead.project}`, randRange(45_000, 160_000));

  for (const optional of OPTIONAL_STEPS) {
    if (Math.random() > optional.chance) continue;
    const durationMs = randRange(20_000, 100_000);
    push(sessionId, step(durationMs), staffIdx, leadIdx, optional.type, optional.label(lead.project), durationMs);
  }

  push(sessionId, step(randRange(5_000, 20_000)), staffIdx, leadIdx, "notes", `Added notes for ${lead.leadName}`, null);
  push(sessionId, step(randRange(3_000, 10_000)), staffIdx, leadIdx, "status", `Marked ${lead.leadName} as Follow-up`, null);
  push(sessionId, step(randRange(4_000, 15_000)), staffIdx, null, "logout", `${staff[staffIdx].name} signed out`, null);
}

for (const e of events) {
  await sql.query(
    `INSERT INTO activity_events
      (id, session_id, staff_email, staff_name, manager_email, lead_id, lead_name, type, label, at, duration_ms, device, location)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (id) DO NOTHING`,
    [
      e.id, e.sessionId, e.staffEmail, e.staffName, e.managerEmail,
      e.leadId, e.leadName, e.type, e.label, e.at, e.durationMs, e.device, e.location,
    ],
  );
}

console.log(`Seeded ${events.length} activity events.`);
