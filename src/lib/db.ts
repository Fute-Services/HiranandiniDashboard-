import { neon } from "@neondatabase/serverless";

/**
 * Lazy singleton, not a Proxy — calling `neon()` at module load time would
 * throw during `next build` if DATABASE_URL isn't set yet, and Proxy-wrapping
 * the client is known to break downstream libraries that introspect it.
 */
let _sql: ReturnType<typeof neon> | null = null;

/**
 * Whether a database is configured at all. The staff flow (login → customer →
 * device → showcase) runs on dummy data by design until the client's API
 * lands, so on a fresh checkout with no `.env.local` there is no Postgres to
 * talk to. Callers that only *enrich* a request — recording which session is
 * current, checking whether an account is suspended — skip themselves when
 * this is false instead of taking the whole request down with them. Callers
 * that genuinely need the data (the admin/manager reports) still call
 * `getSql()` directly and surface the real error.
 */
export function hasDb(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function getSql() {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    // neon()'s own message for a missing string ("Perhaps an environment
    // variable has not been set?") doesn't name the variable or the file, so
    // say both — this is the first thing that breaks on a fresh checkout.
    if (!url) {
      throw new Error(
        "DATABASE_URL is not set. Add it to .env.local (see README) and restart the dev server.",
      );
    }
    _sql = neon(url);
  }
  return _sql;
}
