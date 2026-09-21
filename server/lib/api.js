/**
 * Wraps a route handler so an unexpected throw still answers with JSON.
 *
 * Express's default error handler sends an HTML error page (and, in
 * production, a bare "Internal Server Error"), which every client here then
 * fails to parse — one broken query becomes two errors, and the second one (a
 * JSON parse failure in the browser) hides the first. The real message is
 * logged server-side, and echoed to the client only in development; in
 * production it stays internal.
 *
 * Also what makes `async` handlers safe: an async function that rejects never
 * reaches Express's error handling on its own, so without this a thrown error
 * in a route would leave the request hanging until it timed out.
 */
export function withJsonErrors(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[api]", detail);
      if (res.headersSent) return;
      res.status(500).json({
        error:
          process.env.NODE_ENV === "production"
            ? "Something went wrong on our end. Please try again."
            : `Server error: ${detail}`,
      });
    }
  };
}

/** The cookie options every session cookie shares. `sameSite: "lax"` is what
 * makes the CSRF origin check in lib/csrf.js the second line of defence
 * rather than the only one. `secure` only in production, since local
 * development is plain http and a secure cookie would simply never be set. */
export function cookieOptions(extra = {}) {
  return {
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    ...extra,
  };
}
