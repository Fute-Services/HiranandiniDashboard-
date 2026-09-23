/**
 * Builds docs/Hiranandani-Flow-Short.pdf — the same story as flow-pdf.cjs, on
 * two pages, for someone who wants the shape of it and not the detail.
 *
 *   npm run docs:flow:short
 *
 * Everything here is a shortened version of a section in the full document.
 * When the flow changes, change both — they are built from the same kit, but
 * not from the same text, because a summary that is generated from the long
 * version reads like a long version with pieces missing.
 */
const path = require("path");
const { createDoc, INK, MUTED, GOLD, BAD, WARN } = require("./pdf-kit.cjs");

const OUT =
  process.argv[2] || path.join(__dirname, "..", "..", "docs", "Hiranandani-Flow-Short.pdf");

const { doc, h1, h2, p, bullets, mono, stepBox, table, cover, finish } = createDoc(OUT, {
  Title: "Hiranandani Dashboard — Flow at a glance",
  Author: "Fute Services",
  Subject: "Two-page summary: the three screens, what reaches Sperto, and where data lives",
});

// =========================================================== PAGE 1
cover({
  title: "Hiranandani Dashboard",
  subtitle: "The flow at a glance",
  meta: "Two pages  ·  the full version is Hiranandani-Flow.pdf  ·  23 September 2026",
  height: 128,
  startY: 152,
});

p(
  "Three screens. One login is one customer. There is no “End Session” button — signing out is what closes " +
  "a presentation, so it cannot be left half-ended whichever way the staff member leaves.",
  { size: 10, color: INK }
);

mono([
  "  /login            ->   /session/start        ->   /dashboard",
  "  email or          ->   Lead ID + device      ->   VR tour + projects",
  "  Sales ID              (both Sperto-checked)      (timed per project)",
  "",
  "  Log out from any of them  ->  session closed, times sent to Sperto",
], { bg: "#f6f7f9", accent: GOLD });

stepBox(1, "Sign in", [
  "Email or Sperto Sales ID, no password. Sperto decides whether that identity is real.",
  "Sperto down -> the built-in roster, so the demo always runs.",
  "!Admin / manager sign-in returns 403: reporting is out of scope this release.",
]);

stepBox(2, "Find the customer, pick the device", [
  "Lead ID or phone, checked against Sperto too. Refused -> the session does not start.",
  "No Lead ID -> “Continue without a Lead ID” makes a walk-in record.",
  "Tab / TV / Kiosk / Laptop, chosen rather than guessed. Sperto gets an IN call here.",
], { accent: "#8a6d3b" });

stepBox(3, "The presentation", [
  "The 360° VR tour plays behind a rail of every project. Tapping one opens that",
  "project full-screen in this tab, so the header, the timers and Log out stay reachable.",
  "A per-project clock runs; opening another project stops the first.",
]);

stepBox(4, "Log out — the only way out", [
  "Also happens by itself: 30 minutes idle, an admin force-logout, or the same account",
  "signing in elsewhere. Every exit runs the same code and sends exactly one OUT,",
  "carrying the per-project times.",
], { accent: BAD, last: true });

// =========================================================== PAGE 2
doc.addPage();
h1("What it is made of");

table(
  ["Piece", "What it is"],
  [
    ["Web app", "React 19 + Vite, plain JSX, react-router-dom. Built to dist/."],
    ["API", "Express 5 under /api. Signed httpOnly session cookie, checked on every call."],
    ["CRM", "Sperto — staff check, lead check, and the device-usage log."],
    ["Store", "None of our own: process memory + the browser tab. No database."],
    ["Hosting", "Vercel (CDN + one function), or any Node host as one process."],
  ],
  [0.16, 0.84]
);

h2("Where the data lives");
table(
  ["What", "Where", "Lives until"],
  [
    { cells: ["Activity log, session, per-project times", "The browser tab's sessionStorage", "the tab closes, or sign-out"], colors: [INK, MUTED, MUTED] },
    { cells: ["Lead overlay — who claimed what", "The API process's memory", "that staff member signs out"], colors: [INK, MUTED, MUTED] },
    { cells: ["Controls, added accounts, unit counts", "The API process's memory", "the process restarts"], colors: [INK, MUTED, MUTED] },
  ],
  [0.4, 0.33, 0.27]
);
p(
  "An empty store is the ordinary starting state, not an error — which is what makes a restart clearing it " +
  "acceptable. Two consequences: treat a force-logout as immediate rather than lasting, and a manager sees " +
  "only their own browser's log.",
  { size: 9.5 }
);

h2("What reaches Sperto");
mono([
  "OUT, at logout:",
  "  page_url: [ { \"Elena\": 8 }, { \"Alibaug\": 15 } ]   <- their own field",
  "",
  "That array is the only place the times go - nothing beside it.",
  "Their host answers 200 for a rejection and 500 for a success, so",
  "nothing branches on the status - every answer is read out of the body.",
], { bg: "#fbf6ec", accent: WARN });
p(
  "Time is measured, not inferred: only projects actually opened are reported, reopening adds rather than " +
  "duplicates, two never run at once, a backgrounded tab accrues nothing, and the project on screen at " +
  "logout still counts.",
  { size: 9.5 }
);

h2("Running it");
mono([
  "  npm install && cp .env.example .env.local   # put a SESSION_SECRET in it",
  "  npm run dev     # app :3000, API :3001      npm test   # 70 tests",
  "  npm run build && npm start                  # one process, :3001",
]);
p(
  "SESSION_SECRET is the only required variable. Without Sperto's keys, sign-in and lead lookup fall back to " +
  "the built-in accounts and LEAD-1001 … LEAD-1005 — and turning Sperto on turns those demo customers off.",
  { size: 9.5 }
);

h2("Still open with the client");
bullets([
  "Does their parser accept page_url as an array of { project: seconds }? It is the only field the times are in.",
  "The real device_id per device type — Tab / TV / Kiosk / Laptop are a placeholder 1 / 2 / 3 / 4.",
  "Each staff member's Sperto login code; without one, that account skips the device-usage call.",
]);
p("The full document has the detail behind every line here.", { size: 9, color: GOLD });

finish("Hiranandani Dashboard — flow at a glance");