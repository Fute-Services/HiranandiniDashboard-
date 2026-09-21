/**
 * Per-process sliding-window limiter. In-memory is fine here (unlike the
 * activity/controls data, losing rate-limit state on a restart is a
 * non-issue — worst case a limit resets, nothing is lost).
 */
const buckets = new Map();

export function checkRateLimit(key, limit, windowMs) {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart > windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

export function clientKey(req) {
  return req.get("x-vercel-forwarded-for") ?? req.get("x-forwarded-for") ?? req.ip ?? "unknown";
}
