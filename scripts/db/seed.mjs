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
];

const events = [];
let idCounter = 0;
function push(at, staffIdx, leadIdx, type, label, durationMs) {
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
}

const sessionPlan = [
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
  const step = (ms) => (t += ms);
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
