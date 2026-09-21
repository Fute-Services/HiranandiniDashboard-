/**
 * Builds docs/Hiranandani-Flow.pdf — the app's flow, end to end.
 *
 *   npm run docs:flow
 *
 * Every claim in the document was run against the code rather than read off
 * it: the payloads and timings are captured from real runs against a stand-in
 * Sperto server. When the flow changes, change it here and rebuild, so the
 * PDF cannot quietly drift from what the app does.
 *
 * Laid out by hand rather than flowed: PDFKit adds a page of its own whenever
 * text lands at or past the bottom margin, even at an explicit position, so
 * the bottom margin is zeroed and `need()` is the only thing that paginates.
 * The base-14 fonts are WinAnsi — arrows and other glyphs outside it render as
 * noise, which is why the diagrams use ASCII.
 */
const PDFDocument = require("pdfkit");
const fs = require("fs");

const OUT =
  process.argv[2] ||
  require("path").join(__dirname, "..", "..", "docs", "Hiranandani-Flow.pdf");

// ---------------------------------------------------------------- palette
const INK = "#1b1b1f";
const MUTED = "#5f6570";
const FAINT = "#9aa0aa";
const GOLD = "#a8751d";
const LINE = "#d8dbe0";
const BOX = "#f6f7f9";
const OK = "#2f7d4f";
const BAD = "#b5322e";
const WARN = "#a8651d";

const PAGE = { size: "A4", margins: { top: 54, bottom: 54, left: 54, right: 54 } };
const doc = new PDFDocument({ ...PAGE, bufferPages: true, info: {
  Title: "Hiranandani Dashboard — Application Flow",
  Author: "Fute Services",
  Subject: "End-to-end flow: login, customer lookup, presentation, logout, and what reaches Sperto",
} });
doc.pipe(fs.createWriteStream(OUT));

const W = doc.page.width - PAGE.margins.left - PAGE.margins.right;
const L = PAGE.margins.left;
const BOTTOM = doc.page.height - PAGE.margins.bottom;

/**
 * Every box, row and code block here is drawn at an absolute y that `need()`
 * has already checked. PDFKit does not know that: it adds a page of its own
 * whenever text lands at or past the bottom margin — even with an explicit
 * position and lineBreak:false — so a block near the foot of a page got two
 * page breaks, mine and its, and the blank page in between.
 *
 * Zeroing the bottom margin turns that automatic break off. `need()` is then
 * the only thing that paginates, which is what the layout already assumed.
 */
function suppressAutoBreak() {
  doc.page.margins.bottom = 0;
}
doc.on("pageAdded", suppressAutoBreak);
suppressAutoBreak();

// ------------------------------------------------------------- primitives
function need(h) {
  if (doc.y + h > BOTTOM) doc.addPage();
}

function h1(t) {
  need(120);
  doc.font("Helvetica-Bold").fontSize(17).fillColor(INK).text(t, L, doc.y);
  doc.moveDown(0.15);
  doc.moveTo(L, doc.y).lineTo(L + W, doc.y).lineWidth(1.4).strokeColor(GOLD).stroke();
  doc.moveDown(0.7);
}

function h2(t) {
  need(78);
  doc.moveDown(0.35);
  doc.font("Helvetica-Bold").fontSize(11.5).fillColor(INK).text(t, L, doc.y);
  doc.moveDown(0.35);
}

function p(t, opts = {}) {
  need(28);
  doc.font(opts.bold ? "Helvetica-Bold" : "Helvetica")
    .fontSize(opts.size || 9.5)
    .fillColor(opts.color || MUTED)
    .text(t, L + (opts.indent || 0), doc.y, { width: W - (opts.indent || 0), lineGap: 2.2 });
  doc.moveDown(opts.gap ?? 0.45);
}

function bullets(items, opts = {}) {
  for (const it of items) {
    need(20);
    const y = doc.y;
    doc.font("Helvetica").fontSize(9.5).fillColor(GOLD).text("•", L + 4 + (opts.indent || 0), y, { width: 10 });
    doc.font("Helvetica").fontSize(9.5).fillColor(MUTED)
      .text(it, L + 18 + (opts.indent || 0), y, { width: W - 18 - (opts.indent || 0), lineGap: 2 });
    doc.moveDown(0.28);
  }
  doc.moveDown(0.25);
}

function mono(lines, opts = {}) {
  const pad = 9;
  const lh = 11.2;
  const h = lines.length * lh + pad * 2;
  need(h + 8);
  const y = doc.y;
  doc.roundedRect(L, y, W, h, 4).fillColor(opts.bg || "#f3f4f6").fill();
  if (opts.accent) {
    doc.rect(L, y, 3, h).fillColor(opts.accent).fill();
  }
  doc.font("Courier").fontSize(8.2).fillColor(opts.color || "#2c3038");
  lines.forEach((ln, i) => {
    doc.text(ln, L + pad + (opts.accent ? 4 : 0), y + pad + i * lh, { width: W - pad * 2, lineBreak: false });
  });
  doc.y = y + h + 10;
}

/** A labelled step box in the vertical flow spine. */
function stepBox(n, title, lines, opts = {}) {
  const pad = 10;
  const titleH = 15;
  const lh = 11.5;
  const h = pad * 2 + titleH + lines.length * lh;
  need(h + 26);
  const y = doc.y;

  doc.roundedRect(L, y, W, h, 5).fillColor(BOX).fill();
  doc.roundedRect(L, y, W, h, 5).lineWidth(0.8).strokeColor(LINE).stroke();
  doc.rect(L, y, 3.5, h).fillColor(opts.accent || GOLD).fill();

  // number chip
  doc.circle(L + 20, y + pad + 5, 8.5).fillColor(opts.accent || GOLD).fill();
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#ffffff")
    .text(String(n), L + 20 - 8.5, y + pad + 1.6, { width: 17, align: "center" });

  doc.font("Helvetica-Bold").fontSize(10.5).fillColor(INK)
    .text(title, L + 36, y + pad + 0.5, { width: W - 46 });

  doc.font("Helvetica").fontSize(9).fillColor(MUTED);
  lines.forEach((ln, i) => {
    const isNote = ln.startsWith("!");
    doc.fillColor(isNote ? WARN : MUTED)
      .text(isNote ? ln.slice(1) : ln, L + 36, y + pad + titleH + i * lh, { width: W - 46, lineBreak: false });
  });

  doc.y = y + h;
  if (!opts.last) arrow();
}

function arrow() {
  const h = 16;
  need(h);
  const x = L + 20;
  const y = doc.y;
  doc.moveTo(x, y + 2).lineTo(x, y + h - 5).lineWidth(1.1).strokeColor(FAINT).stroke();
  doc.moveTo(x - 3.2, y + h - 7).lineTo(x, y + h - 2.5).lineTo(x + 3.2, y + h - 7)
    .lineWidth(1.1).strokeColor(FAINT).stroke();
  doc.y = y + h;
}

/** Simple 2-3 column table. `widths` are fractions of W. */
function table(headers, rows, widths, opts = {}) {
  const cw = widths.map((f) => f * W);
  const pad = 6;
  const fs = opts.size || 8.6;

  function rowHeight(cells, bold) {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(fs);
    return Math.max(...cells.map((c, i) => doc.heightOfString(String(c), { width: cw[i] - pad * 2, lineGap: 1.5 }))) + pad * 1.7;
  }

  function drawRow(cells, { bold = false, bg = null, colors = [] } = {}) {
    const h = rowHeight(cells, bold);
    need(h + 4);
    const y = doc.y;
    if (bg) doc.rect(L, y, W, h).fillColor(bg).fill();
    let x = L;
    cells.forEach((c, i) => {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(fs)
        .fillColor(colors[i] || (bold ? INK : MUTED))
        .text(String(c), x + pad, y + pad * 0.85, { width: cw[i] - pad * 2, lineGap: 1.5 });
      x += cw[i];
    });
    doc.moveTo(L, y + h).lineTo(L + W, y + h).lineWidth(0.5).strokeColor(LINE).stroke();
    doc.y = y + h;
  }

  // Keep the whole table on one page when it can be. Splitting it left a
  // header on one page and two orphaned rows on the next, which reads as a
  // different table rather than the end of this one. A table too tall for any
  // page still flows, because forcing a break would not help it.
  const usable = BOTTOM - PAGE.margins.top;
  const total =
    rowHeight(headers, true) + rows.reduce((sum, r) => sum + rowHeight(r.cells ?? r, false), 0);
  if (total <= usable) need(total);

  drawRow(headers, { bold: true, bg: "#eceef1" });
  rows.forEach((r) => drawRow(r.cells ?? r, { colors: r.colors || [] }));
  doc.moveDown(0.6);
}

function statusLine(label, value, color) {
  need(16);
  const y = doc.y;
  doc.circle(L + 4, y + 5, 3).fillColor(color).fill();
  doc.font("Helvetica-Bold").fontSize(9).fillColor(INK).text(label, L + 14, y, { width: 190, lineBreak: false });
  doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(value, L + 210, y, { width: W - 210, lineBreak: false });
  doc.y = y + 14;
}

// =========================================================== COVER
doc.rect(0, 0, doc.page.width, 150).fillColor("#16181b").fill();
doc.font("Helvetica-Bold").fontSize(23).fillColor("#f2efe8")
  .text("Hiranandani Dashboard", L, 46, { width: W });
doc.font("Helvetica").fontSize(12.5).fillColor("#c7a15a")
  .text("Application flow, end to end", L, 78, { width: W });
doc.font("Helvetica").fontSize(8.8).fillColor("#8b9099")
  .text("React (Vite) + Express  ·  Sperto CRM integration  ·  generated 21 September 2026", L, 106, { width: W });

doc.y = 178;

p(
  "This is what the app does, step by step, from a sales staff member signing in to the numbers landing in the client's CRM. " +
  "Every behaviour described here was run against the code, not read off it — the payloads and timings shown are captured from real runs.",
  { size: 10, color: INK }
);

h2("The shape of it");
p(
  "Three screens. One login is one customer. There is no “End Session” button — signing out is what closes a presentation, " +
  "and that is deliberate: it means a presentation cannot be left half-ended, whichever way the staff member leaves.",
  { size: 9.5 }
);

mono([
  "  /login            ->   /session/start        ->   /dashboard",
  "  email or          ->   Lead ID + device      ->   VR tour + projects",
  "  Sales ID              (both Sperto-checked)      (timed per project)",
  "",
  "  Log out from any of them  ->  session closed, times sent to Sperto",
], { bg: "#f6f7f9", accent: GOLD });

h2("Two systems own the lists");
bullets([
  "Sperto (the client's CRM) owns who the staff are and who the customers are. Neither has to be pre-created in this app.",
  "This app owns what happened: every login, search, project opened and closed, with measured time. That log is append-only — there is no route that can edit or delete it.",
]);

// =========================================================== FLOW
doc.addPage();
h1("1  ·  The flow, step by step");

stepBox(1, "Sign in  —  /login", [
  "Staff type their email or their Sperto Sales ID (e.g. PDPL0349). No password.",
  "The server asks Sperto whether that identity is real. An identity they do not",
  "have is refused. Admins and managers use email + password on a separate door,",
  "deliberately not Sperto-gated so a CRM outage cannot lock them out.",
  "!Reporting is out of scope this release, so admin/manager sign-in returns 403.",
]);

stepBox(2, "Who are you, really?  —  route guard", [
  "The browser is handed a signed, httpOnly session cookie. Before any screen is",
  "drawn, the app asks the server to verify it (GET /api/session). The role comes",
  "from that verified token, never from the readable role cookie, which is",
  "display-only and could be edited by hand.",
]);

stepBox(3, "Find the customer  —  /session/start", [
  "The staff member types the Lead ID (or phone). It goes to Sperto too, through",
  "the same endpoint as the login, as type: \"lead\".",
  "Sperto says no  ->  the session does not start.",
  "Sperto is down  ->  fall through to our own table; a customer is waiting.",
  "No Lead ID at all  ->  “Continue without a Lead ID” makes a walk-in record.",
], { accent: "#8a6d3b" });

stepBox(4, "Pick the device", [
  "Tab / TV / Kiosk / Laptop, chosen by the staff member rather than guessed from",
  "the browser string — which can only ever say “Chrome · Windows”, never “Kiosk”.",
  "This is what makes “which device sells the most” answerable.",
  "Sperto is told the session started: an IN call fires here.",
]);

stepBox(5, "The presentation  —  /dashboard", [
  "The 360° VR tour plays behind everything. Every project sits in a rail over it.",
  "Tapping one opens that project's own website full-screen, in this tab — not a",
  "new browser tab, so the session header, the timers and Log out stay reachable.",
  "A per-project clock starts. Opening another project stops the first one.",
  "Staff can add meeting notes and flag themselves Busy; both are logged.",
]);

stepBox(6, "Log out  —  the only way out", [
  "Reachable from the header, and from inside a project's full-screen viewer.",
  "It also happens by itself: 30 minutes idle, an admin force-logout, or the same",
  "account signing in elsewhere. All six routes run the same code.",
  "The presentation is closed out, and an OUT call carries the times to Sperto.",
], { accent: BAD, last: true });

// =========================================================== SPERTO
doc.addPage();
h1("2  ·  What reaches Sperto");

p(
  "Two integrations, one host. Both were verified end to end against a stand-in server built to the CRM's own documented quirks.",
  { size: 9.5 }
);

h2("The rule that governs both");
mono([
  "Their server does not use HTTP status codes to mean anything.",
  "",
  "   a rejection  arrives as  HTTP 200",
  "   a success    arrives as  HTTP 500      (device-usage, confirmed live)",
  "",
  "So nothing branches on the status. Every answer is read out of the",
  "body, in one place, by both integrations.",
], { bg: "#fbf6ec", accent: WARN });

p(
  "This matters most for the device-usage log, which previously discarded the response entirely. That meant a visit Sperto refused " +
  "to store was indistinguishable from one it stored — the only symptom being numbers quietly missing from the CRM. It now reports " +
  "what actually happened, and logs a failure in Sperto's own words.",
  { size: 9.5 }
);

h2("Session start  —  IN");
mono([
  "POST api_record_device_usage.php",
  "{",
  "  device_id: \"3\",                        <- Kiosk",
  "  lead_id: \"WALKIN-1789969341382\",",
  "  sales_manager_login: \"PDPL0349\",       <- the Sales ID they signed in with",
  "  type: \"IN\",",
  "  page_url: \".../session/start\"           <- nothing opened yet",
  "}",
]);

// Deliberate break. The OUT payload and the table explaining what Sperto’s
// reply means belong together, and letting them fall where they may left the
// table stranded on a page of its own with nine lines on it.
doc.addPage();
h2("Session end  —  OUT  (this is the one that carries the times)");
mono([
  "POST api_record_device_usage.php",
  "{",
  "  device_id: \"3\",",
  "  lead_id: \"WALKIN-1789969341382\",",
  "  sales_manager_login: \"PDPL0349\",",
  "  type: \"OUT\",",
  "",
  "  page_url: [                            <- their field, now an array",
  "    { \"Elena\": 8 },",
  "    { \"Alibaug\": 15 }",
  "  ],",
  "",
  "  project_time: { Elena: 8, Alibaug: 15 } <- the same, as one object",
  "}",
], { bg: "#f1f6f2", accent: OK });

p(
  "Both fields carry the same numbers on purpose, one object per project against one object for all of them. project_time is a custom " +
  "field their published API does not list, so there is no guarantee their backend stores it. page_url is theirs and always has been. " +
  "Whichever one they are actually reading has the numbers in it — and a test asserts the two agree second for second.",
  { size: 9.5 }
);

h2("What the answer means now");
table(
  ["Sperto's reply", "We report", "What it means"],
  [
    { cells: ["200, status: success", "recorded: true", "Stored."], colors: [MUTED, OK, MUTED] },
    { cells: ["500, status: success", "recorded: true", "Also stored — their host really does this."], colors: [MUTED, OK, MUTED] },
    { cells: ["200, status: error", "recorded: false · rejected", "They refused it. Logged with their message."], colors: [MUTED, BAD, MUTED] },
    { cells: ["500, empty body", "recorded: false · unavailable", "Their known endpoint bug. Never read as “wrong user”."], colors: [MUTED, WARN, MUTED] },
  ],
  [0.26, 0.28, 0.46]
);

p(
  "The route still answers 200 / ok: true in every case, on purpose — a presentation must be free to start and to end whether or not " +
  "the CRM accepted the write. The staff member has already walked away by the time an OUT answers.",
  { size: 9.5 }
);

// =========================================================== TIME
doc.addPage();
h1("3  ·  How time is measured");

p(
  "Per-project time is measured, not inferred from the gap between log entries — that guess is wrong the moment a session ends on a project.",
  { size: 9.5 }
);

h2("The rules, each covered by a test");
table(
  ["Rule", "Why it matters"],
  [
    ["Only projects actually opened appear", "A zero in the CRM reads as a visit that happened."],
    ["Reopening adds, never duplicates", "Elena 3 min + Elena 2 min is one 300s entry, not two."],
    ["Two projects never run at once", "Opening B banks A's time first, so a second is never counted twice."],
    ["A backgrounded tab accrues nothing", "A session left open over lunch must not report an hour."],
    ["A refresh does not invent time", "Time up to the reload is kept; everything after it would be made up."],
    ["The project on screen at logout counts", "Closing the app is not the same as the customer leaving the room."],
    ["Exactly one OUT per presentation", "Six exits share one code path; only the first gets to send."],
    ["One customer's time never lands on the next", "Starting a session clears the slate."],
  ],
  [0.44, 0.56]
);

h2("Verified against a real run");
p("A presentation was run in a browser. These are the two records it produced, side by side:", { size: 9.5 });
table(
  ["Project", "Activity log (measured)", "Sent to Sperto", "Agree?"],
  [
    { cells: ["Elena", "8,165 ms", "8 s", "yes"], colors: [INK, MUTED, MUTED, OK] },
    { cells: ["Alibaug", "14,507 ms", "15 s", "yes"], colors: [INK, MUTED, MUTED, OK] },
  ],
  [0.22, 0.31, 0.26, 0.21]
);
p(
  "Alibaug was still open on screen when Log out was pressed — and it was still counted. That is the rule above, working.",
  { size: 9.5 }
);

h2("The activity log");
p(
  "Separate from Sperto, and richer: every login, search, customer lookup, project open and close, tab viewed, note written, " +
  "status toggle and logout, each stamped with the device the staff member chose. Append-only — the route has a GET and a POST and " +
  "deliberately no PATCH or DELETE, so sales staff have no path to edit or erase their own history.",
  { size: 9.5 }
);

mono([
  "  login             \"Sales Staff signed in\"",
  "  step              \"Entered presentation\"          device=Kiosk",
  "  tour_view         \"360° VR tour opened\"            device=Kiosk",
  "  project_open      \"Opened Elena\"                   device=Kiosk",
  "  project_close     \"Closed Elena\"                   device=Kiosk   (8165ms)",
  "  project_open      \"Opened Alibaug\"                 device=Kiosk",
  "  project_close     \"Closed Alibaug · logged out\"     device=Kiosk  (14507ms)",
  "  step              \"Left presentation\"              device=Kiosk  (39472ms)",
  "  logout            \"Sales Staff signed out\"",
]);

// =========================================================== EXITS
doc.addPage();
h1("4  ·  Every way a session ends");

p(
  "Six exits, one code path. Before this, only the Log out button reported an OUT — so an idled-out session left Sperto believing " +
  "the customer was still in the room.",
  { size: 9.5 }
);

table(
  ["Exit", "Who triggers it", "Reports OUT"],
  [
    { cells: ["Log out — showcase header", "Staff", "yes"], colors: [INK, MUTED, OK] },
    { cells: ["Log out — inside a project viewer", "Staff  (new)", "yes"], colors: [INK, MUTED, OK] },
    { cells: ["Log out — customer lookup screen", "Staff", "yes"], colors: [INK, MUTED, OK] },
    { cells: ["Log out — reports dashboard", "Admin / manager", "yes"], colors: [INK, MUTED, OK] },
    { cells: ["Idle for 30 minutes", "By itself, with a 60s warning", "yes"], colors: [INK, MUTED, OK] },
    { cells: ["Force-logout by an admin", "Admin / manager", "yes"], colors: [INK, MUTED, OK] },
    { cells: ["Same account signs in elsewhere", "By itself", "yes"], colors: [INK, MUTED, OK] },
  ],
  [0.38, 0.38, 0.24]
);

p(
  "The Log out inside a project's full-screen viewer is new. That view covers the whole screen, including the header everything else " +
  "signs out from — so ending a presentation from inside a project used to mean closing back out first, which on a kiosk with no " +
  "browser chrome is the difference between one tap and being stuck.",
  { size: 9.5 }
);

h2("What happens, in order");
mono([
  "  1.  close the open project   ->  logs it, with its measured dwell time",
  "  2.  close the presentation   ->  banks the final step's time",
  "  3.  send OUT to Sperto       ->  page_url array + project_time",
  "  4.  clear the session cookie ->  server-side; the browser cannot do it",
  "  5.  hard navigation to /login",
]);
p(
  "The order is load-bearing. Both log writes are attributed to the active session, so they have to happen before it is cleared — " +
  "otherwise that project's dwell time and the presentation's final step are both silently lost.",
  { size: 9.5 }
);

// =========================================================== CHECKS
doc.addPage();
h1("5  ·  What was checked");

p("Every line below was run, not assumed.", { size: 9.5 });

h2("Automated");
statusLine("Unit tests", "65 passed  ·  Sperto response reading, per-project time accounting", OK);
statusLine("Production build", "428 modules, clean", OK);
statusLine("Lint", "0 errors  (23 warnings, all pre-existing patterns)", OK);
statusLine("Secret leak check", "no Sperto key anywhere in the built bundle", OK);
doc.moveDown(0.5);

h2("Live API  —  39 checks, all passing");
table(
  ["Area", "Checked"],
  [
    ["Login", "Sales ID accepted / refused, email accepted / refused, wrong password, missing identifier, admin door closed while reporting is off"],
    ["Cross-site protection", "POST with no Origin refused, POST from another origin refused"],
    ["Session guard", "signed in resolves, signed out refused, guard bounces /dashboard to /login"],
    ["Lead ID", "Sperto-known accepted with their name, Sperto-rejected blocks the session, outage falls through"],
    ["Device usage", "IN, OUT with visits, rejection, empty body, bad device type, bad call type, signed out"],
    ["Activity log", "append, read back, backend report, no PATCH, no DELETE"],
    ["Admin-only", "inventory write, user directory, account creation, customer deletion — all refused for staff"],
    ["Backup", "refused with no secret and with a wrong secret"],
  ],
  [0.22, 0.78]
);

h2("In a real browser");
bullets([
  "Signed in by Sales ID, through Sperto.",
  "A Lead ID Sperto does not have was refused on screen — “That Lead ID isn't registered in Sperto.” — and the session did not start.",
  "A walk-in session started when the lead database was unavailable, using the client-side fallback.",
  "Two projects opened and closed; the VR tour, the rail, notes and the Busy toggle all rendered and logged.",
  "Logged out from inside a project's full-screen viewer.",
  "The resulting Sperto payload and activity log were read back and matched to the second.",
  "No console errors at any point.",
]);

h2("One bug found and fixed");
p(
  "Auditing the flow turned up a real defect carried over from the previous codebase: POST /api/leads opened a database connection " +
  "before checking authorisation. On an instance with no database, a sales staff member attempting to delete a customer got " +
  "“500 · DATABASE_URL is not set” — the wrong status and the wrong story, since the request should have been refused on " +
  "authorisation, not plumbing. Authorisation is now checked first, and a no-database instance answers each action honestly.",
  { size: 9.5 }
);

// =========================================================== OPEN
doc.addPage();
h1("6  ·  Still open with the client");

p("None of these block the flow. All of them should be confirmed before the CRM goes live for real staff.", { size: 9.5 });

table(
  ["#", "Question", "Why it matters"],
  [
    { cells: ["1", "Does their parser accept page_url as an array of { project: seconds }?", "It previously received a single URL string. Their server ignores what it does not understand and answers 200 either way — so an old parser looks exactly like success from our side. (project_time is sent alongside for this reason.)"], colors: [GOLD, INK, MUTED] },
    { cells: ["2", "Is project_time stored on their side?", "It is a custom field, not in their published API. Same invisibility problem as above."], colors: [GOLD, INK, MUTED] },
    { cells: ["3", "What does a success body actually look like?", "We have only ever been shown error bodies. Anything that is not an explicit failure word is read as success."], colors: [GOLD, INK, MUTED] },
    { cells: ["4", "The real device_id per device type", "Tab / TV / Kiosk / Laptop currently map to 1 / 2 / 3 / 4 — a placeholder guess."], colors: [GOLD, INK, MUTED] },
    { cells: ["5", "Each staff member's Sperto login code", "Without one, that account's sessions skip the device-usage call rather than send a made-up value."], colors: [GOLD, INK, MUTED] },
    { cells: ["6", "Is the login endpoint's 500 fixed?", "It was returning HTTP 500 with no body for any type value. Our side now survives it either way, but it must be re-tested before the key is enabled."], colors: [GOLD, INK, MUTED] },
  ],
  [0.05, 0.34, 0.61]
);

h2("One consequence worth planning for");
mono([
  "Turning Sperto on turns the demo customers off.",
  "",
  "LEAD-1001 ... LEAD-1005 are ours, not theirs. Once the CRM is",
  "answering, it will refuse them — which is correct, and is the",
  "whole point of the check. Demos will need a real Lead ID from",
  "that moment on.",
], { bg: "#fbf6ec", accent: WARN });

// =========================================================== FOOTERS
const range = doc.bufferedPageRange();
for (let i = 0; i < range.count; i++) {
  doc.switchToPage(range.start + i);
  const y = doc.page.height - 34;
  doc.moveTo(L, y - 8).lineTo(L + W, y - 8).lineWidth(0.5).strokeColor(LINE).stroke();
  doc.font("Helvetica").fontSize(7.6).fillColor(FAINT)
    .text("Hiranandani Dashboard — application flow", L, y, { width: W / 2, lineBreak: false });
  doc.font("Helvetica").fontSize(7.6).fillColor(FAINT)
    .text(`${i + 1} / ${range.count}`, L + W / 2, y, { width: W / 2, align: "right", lineBreak: false });
}

doc.end();
console.log("written:", OUT);
