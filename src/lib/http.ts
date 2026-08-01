/**
 * Client-safe fetch helpers. Deliberately imports nothing from `next/server`
 * — this module ends up in the browser bundle via lib/auth.ts and
 * lib/activity.ts; the route-side error wrapper lives in lib/api.ts instead.
 */

/**
 * How long any one request may take before it's treated as never coming.
 * Generous enough that a slow-but-working showroom connection still gets its
 * answer, short enough that a spinner doesn't outlive the customer standing
 * in front of it.
 */
export const REQUEST_TIMEOUT_MS = 12_000;

/**
 * `fetch` with a deadline, which the platform's own `fetch` does not have —
 * and its absence is what this app's stuck spinners were made of.
 *
 * A request over a bad connection usually doesn't fail. It hangs: no
 * response, no error, no rejection, just a promise that never settles. Every
 * loading flag in this app is cleared in the `.then()` of one of these calls,
 * so a hung request means the flag is never cleared — the button sits on
 * "Signing in…", the panel sits on "Loading projects…", and nothing behind
 * them ever appears. Reloading "fixes" it because the reload tears down the
 * hung request and starts over. That is the reload the sales floor kept
 * having to do, and no amount of error handling downstream can help, because
 * a promise that never settles never reaches the error handling.
 *
 * With a deadline the request always settles, so callers' existing catch
 * blocks (every client in this app already has one, and every one of them
 * degrades to something the UI can render) actually get to run.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reads a JSON body without ever throwing. `Response.json()` rejects on an
 * empty or non-JSON body — which is exactly what a crashed route hands back —
 * and an uncaught rejection there surfaces as a full-screen error overlay
 * instead of the message the screen was ready to show. Callers get null and
 * decide what to say themselves.
 *
 * Reading the body is a second place a request can hang: the headers can
 * arrive and the stream then stall mid-download. The deadline on the request
 * covers this too — an aborted request rejects here and lands as null.
 */
export async function readJsonSafe<T = unknown>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
