/**
 * The server side's own copy of the fetch deadline.
 *
 * Under Next.js the client and the routes shared one module, because both ran
 * in the same build. They no longer do — `src/lib/http.js` is browser code —
 * and the outbound calls this side makes (Sperto, from `sperto.js` and
 * `sperto-device-usage.js`) need the same guarantee for the same reason: a
 * request over a bad connection usually doesn't fail, it hangs, and a promise
 * that never settles never reaches the error handling underneath it.
 *
 * Node 18+ has `fetch` and `AbortController` as globals, so this is the whole
 * of it.
 */

/** Sperto's own timeout is configurable per call (SPERTO_TIMEOUT_MS); this is
 * the fallback for anything that doesn't pass one. */
export const REQUEST_TIMEOUT_MS = 12_000;

export async function fetchWithTimeout(input, init = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
