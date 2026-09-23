/**
 * Per-process sliding-window limiter. In-memory is fine here (unlike the
 * activity/controls data, losing rate-limit state on a restart is a
 * non-issue — worst case a limit resets, nothing is lost).
 */
const buckets = new Map();

/**
 * Nothing ever deleted a bucket, so on a long-lived process the map grew by
 * one entry per distinct key seen — every client IP, every email typed at the
 * login — and none of them were ever reclaimed. A showroom running for weeks
 * is exactly where that adds up, which is the one place this app is meant to
 * run for weeks.
 *
 * Swept here rather than on a timer: a sweep only matters when the map is
 * being used, an interval would keep a serverless instance alive for no
 * reason, and the work is proportional to what is already stale. The bucket
 * this call is about is left alone — it is about to be rewritten anyway.
 */
const SWEEP_EVERY_MS = 60_000;
let lastSweep = 0;

function sweep(now, windowMs) {
  // `now < lastSweep` means the clock stepped backwards — an NTP correction
  // on a long-running box, or a test with a fake clock. Treating that as
  // "due" is what keeps a backwards step from parking the sweep until the
  // clock catches up, which on a large step is never in practice.
  if (now >= lastSweep && now - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart > windowMs) buckets.delete(key);
  }
}

export function checkRateLimit(key, limit, windowMs) {
  const now = Date.now();
  sweep(now, windowMs);
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart > windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

/** How many keys are being tracked. Exported for the test that proves the
 * sweep actually reclaims them. */
export function trackedKeyCount() {
  return buckets.size;
}

export function clientKey(req) {
  return req.get("x-vercel-forwarded-for") ?? req.get("x-forwarded-for") ?? req.ip ?? "unknown";
}
