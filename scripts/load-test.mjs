/**
 * Simulates ~25 concurrent staff sessions (rotating across the real demo
 * accounts — a handful of shared accounts under real concurrent load is the
 * realistic shape, not 25 distinct emails) each logging in and posting a
 * few activity events, to prove Week 3's "will many staff at once actually
 * work" question empirically rather than just by inspection.
 *
 * Usage: node scripts/load-test.mjs [baseUrl] [concurrency]
 */
const BASE_URL = process.argv[2] ?? "http://localhost:3000";
const CONCURRENCY = Number(process.argv[3] ?? 25);

const DEMO_EMAILS = [
  "staff@futeservices.com",
  "aditya@futeservices.com",
  "sneha@futeservices.com",
];

function parseCookie(setCookieHeaders, name) {
  for (const line of setCookieHeaders) {
    const match = line.match(new RegExp(`${name}=([^;]*)`));
    if (match) return `${name}=${match[1]}`;
  }
  return null;
}

async function simulateSession(i) {
  const email = DEMO_EMAILS[i % DEMO_EMAILS.length];
  const t0 = Date.now();

  const loginRes = await fetch(`${BASE_URL}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE_URL },
    body: JSON.stringify({ email, demo: true }),
  });
  if (!loginRes.ok) {
    return { i, email, ok: false, step: "login", status: loginRes.status, ms: Date.now() - t0 };
  }
  const setCookie = [...loginRes.headers].filter(([k]) => k.toLowerCase() === "set-cookie").map(([, v]) => v);
  const cookieHeader = ["hiranandani_auth", "hiranandani_role", "hiranandani_email", "hiranandani_session_id"]
    .map((n) => parseCookie(setCookie, n))
    .filter(Boolean)
    .join("; ");
  const { sessionId } = await loginRes.json();

  for (let e = 0; e < 3; e++) {
    const res = await fetch(`${BASE_URL}/api/activity`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: BASE_URL, Cookie: cookieHeader },
      body: JSON.stringify({
        sessionId,
        staffEmail: email,
        staffName: email,
        type: "search",
        label: `LOADTEST session ${i} event ${e}`,
      }),
    });
    if (!res.ok) {
      return { i, email, ok: false, step: `activity#${e}`, status: res.status, ms: Date.now() - t0 };
    }
  }

  return { i, email, ok: true, ms: Date.now() - t0 };
}

const results = await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => simulateSession(i)));

const failed = results.filter((r) => !r.ok);
const times = results.map((r) => r.ms).sort((a, b) => a - b);
const p50 = times[Math.floor(times.length * 0.5)];
const p95 = times[Math.floor(times.length * 0.95)];

console.log(`Simulated ${CONCURRENCY} concurrent sessions against ${BASE_URL}`);
console.log(`Succeeded: ${results.length - failed.length}/${results.length}`);
console.log(`p50: ${p50}ms  p95: ${p95}ms  max: ${times[times.length - 1]}ms`);
if (failed.length) {
  console.log("Failures:");
  for (const f of failed) console.log(`  session ${f.i} (${f.email}) failed at ${f.step}: HTTP ${f.status}`);
  process.exitCode = 1;
}
