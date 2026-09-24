/**
 * Builds docs/Hiranandani-API-Calls.pdf — every call the staff flow makes,
 * when it fires, how it is sent, and which file sends and answers it.
 *
 *   npm run docs:api
 *
 * Line numbers are written by hand. When a route or a client call moves,
 * update the reference here and rebuild, or the document points at the
 * wrong line.
 */
const path = require("path");
const { createDoc, INK, GOLD, BAD, OK } = require("./pdf-kit.cjs");

const OUT =
  process.argv[2] || path.join(__dirname, "..", "..", "docs", "Hiranandani-API-Calls.pdf");

const { doc, h1, h2, p, bullets, mono, stepBox, table, cover, finish } = createDoc(OUT, {
  Title: "Hiranandani Dashboard — API calls",
  Author: "Fute Services",
  Subject: "Which call goes when, how it is sent, and where it lives in the code",
});

// =========================================================== PAGE 1
cover({
  title: "Hiranandani Dashboard",
  subtitle: "API calls: when, how, and where in the code",
  meta: "Short reference  ·  24 September 2026",
  height: 128,
  startY: 152,
});

p(
  "There are two kinds of call. The browser only ever talks to our own server (/api/...). " +
  "Our server is the only thing that talks to Sperto, because the Sperto api_key must never reach " +
  "the browser. Typing into a field sends nothing: every call below fires on a button press or a page load.",
  { size: 10, color: INK }
);

mono([
  "  Browser  --(GET / POST /api/...)-->  Our server  --(POST only)-->  Sperto",
], { bg: "#f6f7f9", accent: GOLD });

h2("Sperto: the only two endpoints, POST only");

p(
  "Sperto's API is old and answers POST only. Both calls are POST with a raw JSON body and " +
  "Content-Type: application/json (a form body or query string is silently ignored). The HTTP status " +
  "means nothing there, so the answer is read from the body, in server/lib/sperto-response.js. " +
  "Timeout 8 s (SPERTO_TIMEOUT_MS)."
);

table(
  ["Endpoint", "Body", "Sent from"],
  [
    [
      "POST /api_get_details_of_customer.php",
      "{ api_key, id, type }\ntype = sales_manager_email | sales_manager_login | lead",
      "server/lib/sperto.js:94 (spertoLookup)",
    ],
    [
      "POST /api_record_device_usage.php",
      "{ api_key, device_id, lead_id, sales_manager_login, type: IN | OUT, page_url }",
      "server/lib/sperto-device-usage.js:90",
    ],
  ],
  [0.34, 0.4, 0.26]
);

mono([
  "// Staff / lead check",
  '{ "api_key": "...", "id": "PDPL0349", "type": "sales_manager_login" }',
  "",
  "// OUT on logout  -  page_url carries minutes per project (2 decimals)",
  '{ "api_key": "...", "device_id": "1", "lead_id": "985038",',
  '  "sales_manager_login": "PDPL0349", "type": "OUT",',
  '  "page_url": [ { "Elena": 3 }, { "Alibaug": 4.5 } ] }',
]);

// =========================================================== PAGE 2
doc.addPage();
h1("When each call fires");

stepBox(1, "Sign in button (email or Sales ID)", [
  "Browser: POST /api/login           src/lib/auth.js:80  ->  server/routes/login.js:94",
  "Sperto:  POST get_details, type sales_manager_email or sales_manager_login",
  "Sperto success -> signed in.  Not found -> 401.  Sperto down -> 503, not signed in.",
  "On success: POST /api/session/device-usage, type IN   (src/pages/LoginPage.jsx)",
  "Sperto:  POST record_device_usage, type IN, lead_id empty, page_url = the page URL",
]);

stepBox(2, "Every page load, and every 2 seconds while signed in", [
  "Browser: GET /api/session          src/lib/auth.js:123 ->  server/routes/session.js:20",
  "Browser: GET /api/controls (2 s)   src/lib/controls.js:70 -> server/routes/controls.js:25",
  "No Sperto call. Checks the session cookie and force-logout.",
], { accent: "#8a6d3b" });

stepBox(3, "Lead ID / phone search button", [
  "Browser: GET /api/leads?query=     src/lib/leads.js:55 ->  server/routes/leads.js:94",
  "Sperto:  POST get_details, type lead",
  "Sperto says no -> session does not start.  Sperto down -> our fallback answers.",
]);

stepBox(4, "Device chosen (Tab / TV / Kiosk / Laptop)", [
  "Browser: POST /api/leads (claim)   src/lib/leads.js:121 -> server/routes/leads.js:163",
  "No Sperto call. The IN already went at sign-in.",
], { accent: "#8a6d3b" });

stepBox(5, "Dashboard opens", [
  "Browser: GET /api/inventory and GET /api/controls (blocked projects). No Sperto call.",
]);

stepBox(6, "Log out, 30 min idle, or force-logout (all run signOut)", [
  "Browser: POST /api/session/device-usage, type OUT",
  "         src/lib/session.js:62 ->  server/routes/device-usage.js:84",
  "Sperto:  POST record_device_usage, type OUT, lead_id + minutes per project in page_url",
  "         (no presentation started -> lead_id empty, page_url = the page URL)",
  "Browser: POST /api/logout          src/lib/auth.js:150 ->  server/routes/logout.js:20",
], { accent: BAD, last: true });

h2("Worth knowing");
bullets([
  "The GET calls above go to our own server only. Nothing ever sends a GET to Sperto.",
  "IN / OUT are sent only when SPERTO_DEVICE_USAGE_API_KEY is set and the staff member's Sales ID " +
    "is known. They never block the presentation: a failure is written to the server log.",
  "One IN per sign-in and exactly one OUT per sign-out, whichever way it ends (session.js keeps a flag).",
  "No Sperto keys set (local demo): the staff and lead checks use the built-in demo accounts and " +
    "LEAD-1001 to LEAD-1005, and IN / OUT are skipped.",
]);

p("Keys: SPERTO_BASE_URL, SPERTO_API_KEY (staff and lead check), SPERTO_DEVICE_USAGE_API_KEY (IN / OUT). Server-side only.", {
  color: OK,
  size: 8.8,
});

finish("Hiranandani Dashboard  ·  API calls");
