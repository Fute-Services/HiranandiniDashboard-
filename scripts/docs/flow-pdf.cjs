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
 * The two-page summary of the same thing is flow-pdf-short.cjs. Both are drawn
 * with the shared kit in pdf-kit.cjs, which is also where the layout's one
 * quirk (why `need()` is the only thing that paginates) is written down.
 */
const path = require("path");
const { createDoc, INK, MUTED, GOLD, OK, BAD, WARN } = require("./pdf-kit.cjs");

const OUT =
  process.argv[2] || path.join(__dirname, "..", "..", "docs", "Hiranandani-Flow.pdf");

const kit = createDoc(OUT, {
  Title: "Hiranandani Dashboard — Application Flow",
  Author: "Fute Services",
  Subject: "End-to-end flow: login, customer lookup, presentation, logout, and what reaches Sperto",
});
const { doc, h1, h2, p, bullets, mono, stepBox, table, statusLine, cover, finish } = kit;

// =========================================================== COVER
cover({
  title: "Hiranandani Dashboard",
  subtitle: "How the whole thing works, end to end",
  meta: "React (Vite) + Express  ·  Sperto CRM  ·  no database  ·  generated 23 September 2026",
});


p(
  "What the app is, what every screen does, what it stores and where, what reaches the client's CRM, " +
  "and how it is run and deployed. Written against the code as it stands today.",
  { size: 10, color: INK }
);

h2("The shape of it");
p(
  "Three screens. One login is one customer. There is no “End Session” button — signing out is what " +
  "closes a presentation, so it cannot be left half-ended whichever way the staff member leaves.",
  { size: 9.5 }
);

mono([
  "  /login            ->   /session/start        ->   /dashboard",
  "  email or          ->   Lead ID + device      ->   VR tour + projects",
  "  Sales ID              (both Sperto-checked)      (timed per project)",
  "",
  "  Log out from any of them  ->  session closed, times sent to Sperto",
], { bg: "#f6f7f9", accent: GOLD });

h2("Who owns what");
bullets([
  "Sperto (the client's CRM) owns the staff list and the customer list. Nothing has to be pre-created here.",
  "This app owns nothing of its own: no database, no copy of customers, no server-side history.",
  "What happened during a presentation is logged in the staff member's own browser tab, and the measured times go to Sperto.",
]);

h2("The stack, in one line each");
table(
  ["Piece", "What it is"],
  [
    ["Web app", "React 19 + Vite, plain JSX, react-router-dom. Built to dist/."],
    ["API", "Express 5, server/app.js, mounted under /api."],
    ["Session", "Signed httpOnly cookie, verified on every API call."],
    ["CRM", "Sperto — staff check, lead check, device-usage log."],
    ["Store", "Process memory only (server/lib/store.js) + the browser tab."],
    ["Hosting", "Vercel (CDN + one function), or any Node host as one process."],
  ],
  [0.2, 0.8]
);

// =========================================================== FLOW
doc.addPage();
h1("1  ·  The flow, step by step");

stepBox(1, "Sign in  —  /login", [
  "Staff type their email or their Sperto Sales ID (e.g. PDPL0349). No password.",
  "The server asks Sperto whether that identity is real; one they do not have is refused.",
  "Sperto down -> fall back to the built-in roster, so the demo always runs.",
  "Admin / manager have a separate door: email + password, not Sperto-gated.",
  "!Reporting is out of scope this release, so admin / manager sign-in returns 403.",
]);

stepBox(2, "Who are you, really?  —  route guard", [
  "The browser gets a signed, httpOnly session cookie it cannot read or edit.",
  "Before any screen is drawn the app asks the server to verify it (GET /api/session).",
  "The role comes from that verified token, never from the readable role cookie.",
  "The guard picks the screen; the real enforcement is every endpoint re-checking the cookie.",
]);

stepBox(3, "Find the customer  —  /session/start", [
  "The staff member types the Lead ID (or phone). It goes to Sperto through the",
  "same endpoint as the login, as type: \"lead\".",
  "Sperto says no  ->  the session does not start.",
  "Sperto is down  ->  fall through to our own list; a customer is waiting.",
  "No Lead ID at all  ->  “Continue without a Lead ID” makes a walk-in record.",
  "!The screen shows the customer nothing about themselves — they are standing there.",
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
  "account signing in elsewhere. All of those run the same code.",
  "The presentation is closed out, and an OUT call carries the times to Sperto.",
], { accent: BAD, last: true });

// =========================================================== PARTS
doc.addPage();
h1("2  ·  The parts, and what each one does");

h2("The API  —  every endpoint");
table(
  ["Endpoint", "Does"],
  [
    ["POST /api/login", "Checks email+password, or Sales ID / email against Sperto. Mints the session cookie."],
    ["GET /api/session", "Answers who the signed cookie says you are. The route guard's one question."],
    ["POST /api/logout", "Expires the cookie server-side and drops the leads that sitting claimed."],
    ["GET, POST /api/leads", "Lead lookup (Sperto), and the claim / status overlay held in memory."],
    ["POST /api/session/device-usage", "The IN and OUT calls to Sperto, holding the API key server-side."],
    ["GET, POST /api/controls", "Force-logout, suspend, project blocks — the bits two devices must agree on."],
    ["GET, POST /api/inventory", "Units-left per project, admin-entered."],
    ["GET, POST /api/users", "The staff directory and admin-added accounts. Refused to staff."],
  ],
  [0.33, 0.67]
);

h2("Guards on every POST");
bullets([
  "Same-origin check: a POST with no Origin, or one from another site, is refused (server/lib/csrf.js).",
  "Rate limiting on login, per client, in memory — per instance, so it is a speed bump, not a wall.",
  "Authorisation is checked before anything else runs, so a refusal is never reported as a plumbing error.",
  "Passwords are hashed server-side; the hashes live in a server-only module and never ship to the browser.",
]);

h2("The screens");
table(
  ["Screen", "What it is"],
  [
    ["/login", "One step. Staff door, and the admin / manager door behind a link."],
    ["/session/start", "Lead lookup, then the device picker. Nothing about the customer shown."],
    ["/dashboard", "VR tour, project rail, per-project timer, notes, Busy toggle, Log out."],
    ["/admin, /manager", "The reporting dashboards. Built, but switched off this release."],
  ],
  [0.22, 0.78]
);

h2("Two watchers always running");
bullets([
  "IdleLogoutWatcher — 30 minutes with no mouse, key, touch or scroll signs out, after a 60-second countdown.",
  "KickWatcher — polls the controls endpoint, so an admin's force-logout, or the same account signing in elsewhere, lands on this device.",
]);

// =========================================================== STORAGE
doc.addPage();
h1("3  ·  Where everything is stored");

p(
  "There is no database, and that is deliberate. The customer records belong to the client and stay in " +
  "their CRM. What is left is split between two disposable places.",
  { size: 9.5 }
);

table(
  ["What", "Where", "Lives until"],
  [
    { cells: ["Activity log, session data, per-project times", "The browser tab's sessionStorage", "the tab closes, or sign-out"], colors: [INK, MUTED, MUTED] },
    { cells: ["Lead overlay — who claimed what, status", "The API process's memory", "that staff member signs out"], colors: [INK, MUTED, MUTED] },
    { cells: ["Staff controls, admin-added accounts, unit counts", "The API process's memory", "the process restarts"], colors: [INK, MUTED, MUTED] },
  ],
  [0.42, 0.33, 0.25]
);

p(
  "Signing out wipes the first two. The third deliberately survives it — a suspension undone by the very " +
  "logout it caused would be no suspension at all.",
  { size: 9.5 }
);

h2("The honest limits");
bullets([
  "A restart, a redeploy or a serverless cold start clears the API's memory, and two instances do not share it.",
  "Nothing in the sales flow breaks when it is empty: an unknown account is simply one nobody has kicked.",
  "So treat a force-logout as an immediate action rather than a lasting one.",
  "A manager sees only their own browser's log — it cannot cross devices without a server store, and there isn't one.",
  "Anyone with devtools can edit the log in their own tab. The append-only guarantee did not survive the move into the browser.",
]);

h2("The activity log");
p(
  "Every login, search, customer lookup, project open and close, tab viewed, note written, status toggle " +
  "and logout, each stamped with the chosen device. The last 5000 events are kept, in this tab only.",
  { size: 9.5 }
);

mono([
  "  login             \"Sales Staff signed in\"",
  "  step              \"Entered presentation\"           device=Kiosk",
  "  tour_view         \"360 VR tour opened\"             device=Kiosk",
  "  project_open      \"Opened Elena\"                   device=Kiosk",
  "  project_close     \"Closed Elena\"                   device=Kiosk  (8165ms)",
  "  project_open      \"Opened Alibaug\"                 device=Kiosk",
  "  project_close     \"Closed Alibaug - logged out\"    device=Kiosk (14507ms)",
  "  step              \"Left presentation\"              device=Kiosk (39472ms)",
  "  logout            \"Sales Staff signed out\"",
]);

p("To read it back, in the browser console:", { size: 9.5 });
mono([
  "  JSON.parse(sessionStorage.getItem(\"hiranandani.activity\"))",
]);

// =========================================================== SPERTO
doc.addPage();
h1("4  ·  What reaches Sperto");

p(
  "Two integrations, one host: the identity check at login and at lead lookup, and the device-usage log. " +
  "Both were verified end to end against a stand-in server built to the CRM's own documented quirks.",
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
  "This matters most for the device-usage log, which used to discard the response entirely — a visit Sperto " +
  "refused to store looked exactly like one it stored. It now reports what happened, in Sperto's own words.",
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
  "}",
], { bg: "#f1f6f2", accent: OK });

p(
  "page_url is their own field and always has been, so the times travel in it and in nothing else. A custom " +
  "project_time carrying the same numbers was sent beside it for a while; the client asked for the array " +
  "alone, and a test now asserts the OUT body carries only their documented fields.",
  { size: 9.5 }
);

h2("What the answer means");
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
  "The route still answers ok: true in every case, on purpose — a presentation must be free to start and to " +
  "end whether or not the CRM accepted the write. The staff member has already walked away by then.",
  { size: 9.5 }
);

// =========================================================== TIME
doc.addPage();
h1("5  ·  How time is measured");

p(
  "Per-project time is measured, not inferred from the gap between log entries — that guess is wrong the " +
  "moment a session ends on a project.",
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
    ["Exactly one OUT per presentation", "Several exits share one code path; only the first gets to send."],
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

// =========================================================== EXITS
doc.addPage();
h1("6  ·  Every way a session ends");

p(
  "Several exits, one code path. Before this, only the Log out button reported an OUT — so an idled-out " +
  "session left Sperto believing the customer was still in the room.",
  { size: 9.5 }
);

table(
  ["Exit", "Who triggers it", "Reports OUT"],
  [
    { cells: ["Log out — showcase header", "Staff", "yes"], colors: [INK, MUTED, OK] },
    { cells: ["Log out — inside a project viewer", "Staff", "yes"], colors: [INK, MUTED, OK] },
    { cells: ["Log out — customer lookup screen", "Staff", "yes"], colors: [INK, MUTED, OK] },
    { cells: ["Idle for 30 minutes", "By itself, with a 60s warning", "yes"], colors: [INK, MUTED, OK] },
    { cells: ["Force-logout by an admin", "Admin / manager", "yes"], colors: [INK, MUTED, OK] },
    { cells: ["Same account signs in elsewhere", "By itself", "yes"], colors: [INK, MUTED, OK] },
  ],
  [0.38, 0.38, 0.24]
);

h2("What happens, in order");
mono([
  "  1.  close the open project   ->  logs it, with its measured dwell time",
  "  2.  close the presentation   ->  banks the final step's time",
  "  3.  send OUT to Sperto       ->  the page_url array, nothing else",
  "  4.  clear the session cookie ->  server-side; the browser cannot do it",
  "  5.  clear this tab's log     ->  the next customer starts clean",
  "  6.  hard navigation to /login",
]);
p(
  "The order is load-bearing. Both log writes are attributed to the active session, so they have to happen " +
  "before it is cleared — otherwise that project's dwell time and the final step are both silently lost. " +
  "The navigation happens whatever else fails: clearing local state is best-effort, leaving is not.",
  { size: 9.5 }
);

// =========================================================== RUN
doc.addPage();
h1("7  ·  Running and deploying it");

h2("Locally");
mono([
  "  npm install",
  "  cp .env.example .env.local        # then put a SESSION_SECRET in it",
  "  npm run dev                       # app on :3000, API on :3001",
  "",
  "  npm run build                     # -> dist/",
  "  npm start                         # dist/ + API from one process, :3001",
  "  npm test                          # the Vitest suite",
  "  npm run docs:flow                 # rebuilds this PDF",
]);
p(
  "In dev, Vite proxies /api to the API, so the browser only ever sees one origin — which is what keeps the " +
  "SameSite cookie and the origin check working. Never split the app and the API across two origins.",
  { size: 9.5 }
);

h2("On Vercel");
mono([
  "  dist/             served by the CDN",
  "  api/index.js  ->  server/app.js   (all of /api/*)",
]);
p(
  "vercel.json carries the build and two rewrites: /api/* to the one function, and everything else to " +
  "index.html so a hard load of /session/start works. Set SESSION_SECRET before the first deploy — the " +
  "build succeeds without it and every sign-in then 500s.",
  { size: 9.5 }
);

h2("Environment");
table(
  ["Variable", "Needed for"],
  [
    ["SESSION_SECRET", "Required. Signs the session cookie the API verifies."],
    ["API_PORT", "Optional (default 3001). Where the API listens."],
    ["SPERTO_BASE_URL", "The CRM that verifies staff and leads, and logs device usage."],
    ["SPERTO_API_KEY", "Server-side only — never reaches the browser."],
    ["SPERTO_DEVICE_USAGE_API_KEY", "Separate key for the device-usage log."],
    ["SPERTO_TIMEOUT_MS", "Optional, default 8000."],
    ["VITE_SENTRY_DSN", "Optional client-side error reporting. Must be VITE_-prefixed."],
  ],
  [0.3, 0.7]
);
p(
  "Only VITE_-prefixed variables reach the browser. Everything else stays on the server, which is the point — " +
  "SPERTO_API_KEY in particular must never ship.",
  { size: 9.5 }
);

h2("Without any credentials at all");
bullets([
  "No Sperto keys set: staff sign-in and lead lookup fall back to the built-in accounts and five demo customers.",
  "Demo accounts: staff@, aditya@, sneha@ (staff123); admin@ (admin123); manager@ (manager123).",
  "Demo customers: LEAD-1001 … LEAD-1005, each also findable by phone number.",
  "Turning Sperto on turns those demo customers off — they are ours, not theirs, so the CRM will refuse them.",
]);

// =========================================================== CHECKS
doc.addPage();
h1("8  ·  What was checked");

p("Every line below was run, not assumed.", { size: 9.5 });

h2("Automated");
statusLine("Unit tests", "70 passed  ·  Sperto response reading, per-project time accounting", OK);
statusLine("Production build", "clean", OK);
statusLine("Lint", "0 errors  (23 warnings, all pre-existing patterns)", OK);
statusLine("Secret leak check", "no Sperto key anywhere in the built bundle", OK);
doc.moveDown(0.5);

h2("Live API");
table(
  ["Area", "Checked"],
  [
    ["Login", "Sales ID accepted / refused, email accepted / refused, wrong password, missing identifier, admin door closed while reporting is off"],
    ["Cross-site protection", "POST with no Origin refused, POST from another origin refused"],
    ["Session guard", "signed in resolves, signed out refused, guard bounces /dashboard to /login"],
    ["Lead ID", "Sperto-known accepted with their name, Sperto-rejected blocks the session, outage falls through"],
    ["Device usage", "IN, OUT with visits, rejection, empty body, bad device type, bad call type, signed out"],
    ["Admin-only", "inventory write, user directory, account creation — all refused for staff"],
  ],
  [0.22, 0.78]
);

h2("In a real browser");
bullets([
  "Signed in by Sales ID, through Sperto.",
  "A Lead ID Sperto does not have was refused on screen, and the session did not start.",
  "A walk-in session started with the lead lookup unavailable, using the fallback.",
  "Two projects opened and closed; the VR tour, the rail, notes and the Busy toggle all rendered and logged.",
  "Logged out from inside a project's full-screen viewer.",
  "The resulting Sperto payload and activity log were read back and matched to the second.",
  "No console errors at any point.",
]);

// =========================================================== OPEN
doc.addPage();
h1("9  ·  Still open, and not built yet");

p("None of these block the flow. All should be confirmed before the CRM goes live for real staff.", { size: 9.5 });

table(
  ["#", "Question", "Why it matters"],
  [
    { cells: ["1", "Does their parser accept page_url as an array of { project: seconds }?", "It previously received a single URL string. Their server ignores what it does not understand and answers 200 either way — so an old parser looks exactly like success from our side. It is now the only field the times are in."], colors: [GOLD, INK, MUTED] },
    { cells: ["2", "What does a success body actually look like?", "We have only ever been shown error bodies. Anything that is not an explicit failure word is read as success."], colors: [GOLD, INK, MUTED] },
    { cells: ["3", "The real device_id per device type", "Tab / TV / Kiosk / Laptop currently map to 1 / 2 / 3 / 4 — a placeholder guess."], colors: [GOLD, INK, MUTED] },
    { cells: ["4", "Each staff member's Sperto login code", "Without one, that account's sessions skip the device-usage call rather than send a made-up value."], colors: [GOLD, INK, MUTED] },
    { cells: ["5", "Is the login endpoint's 500 fixed?", "It was returning HTTP 500 with no body for any type value. Our side survives it either way, but re-test before enabling the key."], colors: [GOLD, INK, MUTED] },
  ],
  [0.05, 0.34, 0.61]
);

h2("Not built yet");
bullets([
  "Property data is hardcoded in src/data/properties.js; the content API plugs in there.",
  "Floor plans have no media — a captioned placeholder renders instead.",
  "Admin and manager reporting dashboards exist as pages but are switched off (REPORTING_ENABLED, in both auth modules).",
]);

h2("One consequence worth planning for");
mono([
  "Turning Sperto on turns the demo customers off.",
  "",
  "LEAD-1001 ... LEAD-1005 are ours, not theirs. Once the CRM is",
  "answering, it will refuse them - which is correct, and is the",
  "whole point of the check. Demos will need a real Lead ID from",
  "that moment on.",
], { bg: "#fbf6ec", accent: WARN });


// =========================================================== FOOTERS
finish("Hiranandani Dashboard — application flow");
