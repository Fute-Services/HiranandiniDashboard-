import { neon } from "@neondatabase/serverless";

/**
 * Lazy singleton, not a Proxy — calling `neon()` at module load time would
 * throw during `next build` if DATABASE_URL isn't set yet, and Proxy-wrapping
 * the client is known to break downstream libraries that introspect it.
 */
let _sql: ReturnType<typeof neon> | null = null;

export function getSql() {
  if (!_sql) _sql = neon(process.env.DATABASE_URL!);
  return _sql;
}
