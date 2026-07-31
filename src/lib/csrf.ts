/** Rejects cross-site POSTs by checking Origin (falling back to Referer)
 * against the request's own host — cheap CSRF protection with no session
 * table or token to manage. */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin") ?? req.headers.get("referer");
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}
