/**
 * Puts a floor's worth of staff through the whole flow at once, against a
 * running server, to answer "does this hold up with many users?" with numbers
 * instead of an opinion.
 *
 * Each simulated session does what a real one does: sign in, ask who it is,
 * report the session started to Sperto, poll the controls endpoint the way
 * KickWatcher does, report the session ended with its per-project times, and
 * sign out.
 *
 * Accounts are rotated across the demo roster rather than invented per
 * session, because that is the real shape: a showroom shares a handful of
 * logins across every device on the floor. It is also the case that used to
 * break — the per-email login limit was low enough that the sixth device in a
 * minute was told to try again later.
 *
 * Usage: node scripts/load-test.mjs [baseUrl] [concurrency]
 *   node scripts/load-test.mjs http://localhost:3001 50
 */
const BASE_URL = process.argv[2] ?? "http://localhost:3001";
const CONCURRENCY = Number(process.argv[3] ?? 25);

const DEMO_EMAILS = [
  "staff@hiranandani.com",
  "aditya@hiranandani.com",
  "sneha@hiranandani.com",
];

/** Everything the browser would send back, as one Cookie header. */
function cookieHeaderFrom(res) {
  return res.headers
    .getSetCookie()
    .map((line) => line.split(";")[0])
    .join("; ");
}

async function step(name, run) {
  const res = await run();
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${name} -> ${res.status} ${body.slice(0, 120)}`);
  }
  return res;
}

async function simulateSession(i) {
  const email = DEMO_EMAILS[i % DEMO_EMAILS.length];
  const leadId = `LOAD-${1000 + i}`;
  const t0 = Date.now();
  const json = { "Content-Type": "application/json", Origin: BASE_URL };

  try {
    const loginRes = await step("login", () =>
      fetch(`${BASE_URL}/api/login`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ email }),
      }),
    );
    const cookie = cookieHeaderFrom(loginRes);
    const { sessionId } = await loginRes.json();

    await step("session", () => fetch(`${BASE_URL}/api/session`, { headers: { Cookie: cookie } }));

    await step("device-usage IN", () =>
      fetch(`${BASE_URL}/api/session/device-usage`, {
        method: "POST",
        headers: { ...json, Cookie: cookie },
        body: JSON.stringify({
          leadId,
          deviceType: "Kiosk",
          type: "IN",
          pageUrl: `${BASE_URL}/session/start`,
        }),
      }),
    );

    // What KickWatcher does every couple of seconds, for every signed-in
    // device on the floor — the highest-volume call in the app by far.
    for (let poll = 0; poll < 5; poll++) {
      const query = new URLSearchParams({ email, sessionId });
      await step(`controls#${poll}`, () =>
        fetch(`${BASE_URL}/api/controls?${query}`, { headers: { Cookie: cookie } }),
      );
    }

    await step("device-usage OUT", () =>
      fetch(`${BASE_URL}/api/session/device-usage`, {
        method: "POST",
        headers: { ...json, Cookie: cookie },
        body: JSON.stringify({
          leadId,
          deviceType: "Kiosk",
          type: "OUT",
          // The only field the times travel in — see docs/sperto.md.
          pageUrl: [{ Elena: 180 }, { Alibaug: 240 }],
        }),
      }),
    );

    await step("logout", () =>
      fetch(`${BASE_URL}/api/logout`, { method: "POST", headers: { ...json, Cookie: cookie } }),
    );

    return { i, email, ok: true, ms: Date.now() - t0 };
  } catch (err) {
    return { i, email, ok: false, reason: String(err.message ?? err), ms: Date.now() - t0 };
  }
}

const started = Date.now();
const results = await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => simulateSession(i)));
const wall = Date.now() - started;

const failed = results.filter((r) => !r.ok);
const times = results.map((r) => r.ms).sort((a, b) => a - b);
const at = (p) => times[Math.min(times.length - 1, Math.floor((times.length * p) / 100))];

console.log(`${CONCURRENCY} concurrent sessions against ${BASE_URL}`);
console.log(`  ok        ${results.length - failed.length}/${results.length}`);
console.log(`  wall      ${wall} ms for the whole run`);
console.log(`  per user  p50 ${at(50)} ms · p95 ${at(95)} ms · max ${times[times.length - 1]} ms`);
console.log(`  requests  ${results.length * 10} across login, session, device-usage, controls, logout`);

for (const f of failed.slice(0, 10)) console.log(`  FAILED #${f.i} (${f.email}): ${f.reason}`);

process.exit(failed.length > 0 ? 1 : 0);
