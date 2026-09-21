import { createApp, warnIfUnconfigured } from "../server/app.js";

/**
 * The whole API as one Vercel Serverless Function.
 *
 * One function rather than a file per endpoint: the routes are already an
 * Express app with its own mounting, ordering and shared middleware, and
 * splitting them into a dozen Vercel entry points would duplicate all of that
 * and let the two drift.
 *
 * `serveStatic: false` because Vercel's CDN serves `dist/` (see vercel.json).
 * A function reaching for those files would be both slower and wrong.
 *
 * ## Why the path is reconstructed
 *
 * A catch-all filename (`api/[...path].js`) was tried first and does not work
 * here: Vercel matched it a single segment deep, so `/api/login` reached the
 * function and `/api/session/device-usage` and `/api/cron/backup` returned
 * Vercel's own 404 without ever getting to Express.
 *
 * So the routing is explicit instead — vercel.json rewrites every `/api/*`
 * request to this one file and carries the real path along in
 * `__vercel_path`. That is deterministic: it does not depend on how a
 * filename convention is interpreted. The cost is that `req.url` arrives
 * pointing at `/api/index`, so it has to be put back before Express sees it,
 * because the routers are mounted on the real paths (`/api/login`, and so on)
 * and must stay that way — the same app is what `npm start` runs directly,
 * with no rewrite in front of it.
 */
warnIfUnconfigured();

const app = createApp({ serveStatic: false });

/** The query key vercel.json stashes the original path in. Named for what it
 * is, and stripped below so no route ever sees it. */
const PATH_KEY = "__vercel_path";

export default function handler(req, res) {
  // Parsed against a throwaway origin purely to get the query API; only
  // `pathname` + `search` are ever used, and only as a relative URL.
  const url = new URL(req.url ?? "/", "http://vercel.internal");
  const original = url.searchParams.get(PATH_KEY);

  if (original !== null) {
    url.searchParams.delete(PATH_KEY);
    // Leading slash normalised: the rewrite's `:path*` capture has none, and
    // an empty capture (a bare `/api`) must still land on `/api`.
    const suffix = original.replace(/^\/+/, "");
    req.url = `/api${suffix ? `/${suffix}` : ""}${url.search}`;
  }

  return app(req, res);
}
