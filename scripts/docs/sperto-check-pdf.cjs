/**
 * Builds docs/Hiranandani-Sperto-Check.pdf — two pages: what is sent to
 * Sperto at login, at the device step and at logout, and what was checked.
 *
 *   npm run docs:check
 *
 * When the IN/OUT flow changes (src/lib/session.js, server/routes/
 * device-usage.js), change this too.
 */
const path = require("path");
const { createDoc, INK, MUTED, GOLD, OK, BAD, WARN } = require("./pdf-kit.cjs");

const OUT =
  process.argv[2] || path.join(__dirname, "..", "..", "docs", "Hiranandani-Sperto-Check.pdf");

const { doc, h1, h2, p, bullets, mono, stepBox, table, cover, finish } = createDoc(OUT, {
  Title: "Hiranandani Dashboard — Sperto IN/OUT check",
  Author: "Fute Services",
  Subject: "What goes to Sperto at login, device pick and logout, and what was tested",
});

// =========================================================== PAGE 1
cover({
  title: "Sperto IN / OUT",
  subtitle: "What is sent, when, and what was checked",
  meta: "Two pages  ·  28 September 2026",
  height: 128,
  startY: 152,
});

p(
  "Only one Sperto API is called: api_record_device_usage.php. It is called twice per presentation — " +
  "IN when it starts, OUT when it ends. The api_key stays on our server; the browser never sees it.",
  { size: 10, color: INK }
);

mono([
  "  POST https://net4hgc.sperto.co.in/_api/api_record_device_usage.php",
  "  Content-Type: application/json",
], { bg: "#f6f7f9", accent: GOLD });

stepBox(1, "Login — Sales ID", [
  "Staff type their Sales ID (any ID, e.g. PDPL0349). Nothing is sent to Sperto here.",
  "The Sales ID is kept in the signed session cookie and used as sales_manager_login later.",
]);

stepBox(2, "Lead ID + device  ->  IN (the check)", [
  "After the Lead ID is entered and a device is picked, the server sends IN:",
  "{ api_key, device_id, lead_id, sales_manager_login, type: \"IN\",",
  "  page_url: \"https://net4hgc.sperto.co.in\" }",
  "Sperto answers success  ->  the presentation opens.",
  "!Sperto says error (wrong Sales ID / Lead ID) or is unreachable  ->  it does not open;",
  "!Sperto's message is shown on the same screen and the staff member can retry.",
], { accent: "#8a6d3b" });

stepBox(3, "Presentation", [
  "A clock runs per project opened (Elena, Alibaug, ...). Nothing is sent meanwhile.",
]);

stepBox(4, "Logout  ->  OUT", [
  "Sent once, with the same lead_id / device_id / sales_manager_login and type \"OUT\".",
  "page_url carries the minutes per project:  [ { \"Elena\": 3 }, { \"Alibaug\": 4.5 } ]",
  "Also sent on idle timeout / force-logout. Not sent if no presentation was started.",
], { accent: BAD, last: true });

// =========================================================== PAGE 2
doc.addPage();
h1("What was checked");

p(
  "The real server was run against a stand-in Sperto that accepts only certain Sales IDs and Lead IDs, " +
  "so no test entries were written into the client's CRM.",
  { size: 9.5 }
);

const pass = (name, detail) => ({ cells: ["PASS", name, detail], colors: [OK, INK, MUTED] });
table(
  ["", "Check", "Result"],
  [
    pass("Login with Sales ID", "Works; no call to Sperto"),
    pass("IN, correct Sales ID + Lead ID", "Sperto success -> presentation allowed"),
    pass("IN request body", "Exactly the 6 fields, in Sperto's format"),
    pass("IN, wrong Lead ID", "Blocked, Sperto's message shown"),
    pass("IN, wrong Sales ID", "Blocked, Sperto's message shown"),
    pass("Other Sales IDs / Lead IDs", "Whatever is typed is sent — nothing hardcoded"),
    pass("IN without Lead ID", "Refused before calling Sperto"),
    pass("IN without login", "Refused (401)"),
    pass("Sperto down", "Blocked with \"could not reach Sperto\""),
    pass("OUT", "Times in page_url; only the 6 fields"),
    pass("OUT sent once", "Even if logout runs twice"),
    pass("API key", "Never in the browser, masked (***) in logs"),
    pass("Unit tests / lint / build", "60 of 60 tests, 0 lint errors, build OK"),
  ],
  [0.08, 0.4, 0.52]
);

h2("Where to see it live");
p(
  "Every call is logged by the server — the terminal locally, Vercel's Logs tab in production:",
  { size: 9.5 }
);
mono([
  "[device-usage] -> POST .../api_record_device_usage.php {\"api_key\":\"***\", ...}",
  "[device-usage] <- HTTP 200 {\"status\":\"success\", ...}",
], { bg: "#f6f7f9" });

h2("Still open with the client");
bullets([
  "device_id is a placeholder: Tab 1, TV 2, Kiosk 3, Laptop 4 — needs Sperto's real IDs.",
  "\"Continue without a Lead ID\" sends a WALKIN-… lead_id, which Sperto will likely reject.",
  "A wrong Sales ID is only caught at the IN step, not at login — Sperto gives no separate check.",
]);
p("Files: server/routes/device-usage.js, server/lib/sperto-device-usage.js, src/lib/session.js, " +
  "src/components/SessionStart.jsx.", { size: 8.5, color: GOLD });

finish("Sperto IN / OUT");
