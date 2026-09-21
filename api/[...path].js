import { createApp, warnIfUnconfigured } from "../server/app.js";

/**
 * The whole API as one Vercel Serverless Function.
 *
 * A catch-all (`[...path]`) rather than a file per endpoint: the routes are
 * already an Express app with its own mounting, ordering and shared
 * middleware, and splitting them into a dozen Vercel entry points would
 * duplicate all of that and let the two drift. Vercel hands this every
 * `/api/*` request with `req.url` still carrying the full path, which is
 * exactly what the app's own `app.use("/api/…")` mounts expect — so the same
 * code serves both here and `npm start`.
 *
 * `serveStatic: false` because Vercel's CDN serves `dist/` (see vercel.json's
 * rewrites). A function reaching for those files would be both slower and
 * wrong.
 *
 * Built once per cold start, then reused across invocations on that instance
 * — which is also why the in-memory rate limiter and the file-backed activity
 * log are per-instance here. Both already say so; see `server/lib/rate-limit.js`
 * and the README's note on where the activity log is stored.
 */
warnIfUnconfigured();

const app = createApp({ serveStatic: false });

export default app;
