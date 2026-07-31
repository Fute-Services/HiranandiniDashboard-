/**
 * Per-process sliding-window limiter. In-memory is fine here (unlike the
 * activity/controls data, losing rate-limit state on a restart is a
 * non-issue — worst case a limit resets, nothing is lost).
 */
const buckets = new Map<string, { count: number; windowStart: number }>();

export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
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

export function clientKey(req: Request): string {
  const h = req.headers;
  return h.get("x-vercel-forwarded-for") ?? h.get("x-forwarded-for") ?? "unknown";
}
