/**
 * Client-safe fetch helpers. Deliberately imports nothing from `next/server`
 * — this module ends up in the browser bundle via lib/auth.ts and
 * lib/activity.ts; the route-side error wrapper lives in lib/api.ts instead.
 */

/**
 * Reads a JSON body without ever throwing. `Response.json()` rejects on an
 * empty or non-JSON body — which is exactly what a crashed route hands back —
 * and an uncaught rejection there surfaces as a full-screen error overlay
 * instead of the message the screen was ready to show. Callers get null and
 * decide what to say themselves.
 */
export async function readJsonSafe<T = unknown>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
