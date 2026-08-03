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
  push(sessionId, step(20_000), staffIdx, null, "search", `Searched lead ${lead.leadId}`, null);
  push(sessionId, step(15_000), staffIdx, leadIdx, "customer_profile", `Opened profile for ${lead.leadName}`, null);
  push(sessionId, step(90_000), staffIdx, leadIdx, "project_open", `Opened ${lead.project}`, 90_000);
  push(sessionId, step(120_000), staffIdx, leadIdx, "floor_plan", `Viewed floor plans, ${lead.project}`, 120_000);
  push(sessionId, step(75_000), staffIdx, leadIdx, "gallery", `Browsed gallery, ${lead.project}`, 75_000);
  push(sessionId, step(45_000), staffIdx, leadIdx, "amenities", `Viewed amenities, ${lead.project}`, 45_000);
  push(sessionId, step(30_000), staffIdx, leadIdx, "brochure_download", `Downloaded brochure, ${lead.project}`, null);
  push(sessionId, step(10_000), staffIdx, leadIdx, "notes", `Added notes for ${lead.leadName}`, null);
  push(sessionId, step(5_000), staffIdx, leadIdx, "status", `Marked ${lead.leadName} as Follow-up`, null);
  push(sessionId, step(8_000), staffIdx, null, "logout", `${staff[staffIdx].name} signed out`, null);
}

// The real leads directory (src/lib/leads.ts used to hardcode these
// in-memory; now they live here so `assigned_staff_email` and lead_status
// changes actually persist). Left unassigned — the first staff member to
// start a session with one claims it, which is also when the ownership
// audit trail (lead_reassigned) starts mattering.
const leadRows = [
  { leadId: "LEAD-1001", phone: "9876543210", name: "Rohan Mehta", budget: "₹1.8 Cr – ₹2.2 Cr", preferredProject: "The Arena", leadStatus: "Hot", previousVisits: 2, interestedTower: "Arcadia", familySize: 4, loanRequirement: true },
  { leadId: "LEAD-1002", phone: "9822011223", name: "Priya Nair", budget: "₹2.5 Cr – ₹3 Cr", preferredProject: "Elena", leadStatus: "Follow-up", previousVisits: 1, interestedTower: "Elena", familySize: 3, loanRequirement: true },
  { leadId: "LEAD-1003", phone: "9900112233", name: "Arjun & Kavita Shah", budget: "₹3.2 Cr+", preferredProject: "Golden Willows", leadStatus: "Negotiation", previousVisits: 3, interestedTower: "Golden Willows", familySize: 5, loanRequirement: false },
  { leadId: "LEAD-1004", phone: "9765004321", name: "Sameer Deshpande", budget: "₹1.4 Cr – ₹1.7 Cr", preferredProject: "Ebony", leadStatus: "New", previousVisits: 0, interestedTower: "Ebony", familySize: 2, loanRequirement: true },
  { leadId: "LEAD-1005", phone: "9820556677", name: "Fatima Sheikh", budget: "₹2.0 Cr – ₹2.4 Cr", preferredProject: "Club House", leadStatus: "Hot", previousVisits: 2, interestedTower: "Elena", familySize: 4, loanRequirement: false },
  { leadId: "LEAD-1006", phone: "9930778899", name: "Vikram Joshi", budget: "₹2.8 Cr – ₹3.1 Cr", preferredProject: "Golden Willows", leadStatus: "Follow-up", previousVisits: 1, interestedTower: "Golden Willows", familySize: 3, loanRequirement: true },
];

for (const l of leadRows) {
  await sql.query(
    `INSERT INTO leads
      (lead_id, phone, name, budget, preferred_project, lead_status, previous_visits, interested_tower, family_size, loan_requirement, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (lead_id) DO NOTHING`,
    [l.leadId, l.phone, l.name, l.budget, l.preferredProject, l.leadStatus, l.previousVisits, l.interestedTower, l.familySize, l.loanRequirement, now],
  );
}
console.log(`Seeded ${leadRows.length} leads.`);

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
