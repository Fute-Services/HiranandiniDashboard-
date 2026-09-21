/**
 * Rejects cross-site POSTs by checking Origin (falling back to Referer)
 * against the request's own host — cheap CSRF protection with no session
 * table or token to manage.
 *
 * In development the browser only ever talks to the Vite dev server, which
 * proxies `/api` here without rewriting the Host header (see vite.config.js's
 * `changeOrigin: false`), so the two still agree — which is the whole reason
 * the proxy is set up that way rather than pointing the app at the API's own
 * port.
 */
export function isSameOrigin(req) {
  const origin = req.get("origin") ?? req.get("referer");
  if (!origin) return false;
  try {
    return new URL(origin).host === req.get("host");
  } catch {
    return false;
  }
}
