import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cookieParser from "cookie-parser";

import { sessionRouter } from "./routes/session.js";
import { loginRouter } from "./routes/login.js";
import { logoutRouter } from "./routes/logout.js";
import { activityRouter } from "./routes/activity.js";
import { controlsRouter } from "./routes/controls.js";
import { inventoryRouter } from "./routes/inventory.js";
import { leadsRouter } from "./routes/leads.js";
import { usersRouter } from "./routes/users.js";
import { deviceUsageRouter } from "./routes/device-usage.js";
import { cronRouter } from "./routes/cron.js";

/**
 * The API.
 *
 * Everything under `/api` here was a Next.js route handler under
 * `src/app/api/**` before. The handlers themselves changed as little as the
 * move allowed — same checks in the same order, same status codes, same
 * bodies — because the clients in `src/lib/*` read those bodies field by
 * field and every one of them has an error path keyed to a specific shape.
 *
 * What did change is the shape of a handler: `NextRequest`/`NextResponse`
 * became Express's `req`/`res`, `req.nextUrl.searchParams` became `req.query`,
 * and `res.cookies.set()` became `res.cookie()`. The wrapper that turns an
 * uncaught throw into JSON (`lib/api.js`) also now does double duty as the
 * thing that keeps an async handler's rejection from hanging the request.
 *
 * In development this listens on its own port and the Vite dev server proxies
 * `/api` to it (see vite.config.js), so the browser only ever sees one
 * origin — which is what keeps the SameSite cookie and the CSRF origin check
 * working. In production it also serves the built `dist/`, so the same
 * process answers both and there is no proxy to configure.
 */

const app = express();
const PORT = Number(process.env.API_PORT ?? 3001);

// Behind a reverse proxy (the Vite dev server, or whatever fronts this in
// production), so the client IP the rate limiter keys on comes from
// X-Forwarded-For rather than the proxy's own socket address.
app.set("trust proxy", true);
// The routes were written against `await req.json()` and treat a missing body
// as `{}`; `express.json()` gives them `req.body` with the same effect.
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.use("/api/session/device-usage", deviceUsageRouter);
// After the device-usage mount: Express matches prefixes in order, and
// "/api/session" would otherwise swallow it.
app.use("/api/session", sessionRouter);
app.use("/api/login", loginRouter);
app.use("/api/logout", logoutRouter);
app.use("/api/activity", activityRouter);
app.use("/api/controls", controlsRouter);
app.use("/api/inventory", inventoryRouter);
app.use("/api/leads", leadsRouter);
app.use("/api/users", usersRouter);
app.use("/api/cron", cronRouter);

// An unmatched /api/* is a 404 in JSON, not Express's HTML page — every
// client here parses the body it gets back, and an HTML 404 surfaces in the
// browser as a parse error that hides the real "no such endpoint".
app.use("/api", (req, res) => {
  res.status(404).json({ error: "Not found" });
});

/**
 * Production only: serve the built app from the same origin.
 *
 * Skipped entirely when `dist/` isn't there, which is the ordinary
 * development case — Vite is serving the app then, and this process is only
 * the API behind its proxy.
 *
 * The catch-all matters: this is a client-routed single-page app, so a
 * hard load of `/session/start` has to return `index.html` and let the
 * router take it from there. Without it, every URL but `/` would 404 on
 * refresh.
 *
 * It is a bare `app.use`, not `app.get("*")` — Express 5's path parser
 * rejects an unnamed `*` outright (it wants `/*splat`), and this needs no
 * params anyway. Anything that reaches here has already missed every `/api`
 * route above, including their own JSON 404.
 */
const distDir = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.use((req, res) => {
    res.sendFile(join(distDir, "index.html"));
  });
}

if (!process.env.SESSION_SECRET) {
  // Not fatal at boot — the routes that need it throw with their own message,
  // and everything that doesn't (the dummy-data staff flow) still runs. But
  // this is the first thing that goes wrong on a fresh checkout, so say it
  // once, loudly, rather than letting it surface as a 500 on sign-in.
  console.warn(
    "[api] SESSION_SECRET is not set — sign-in will fail. Copy .env.example to .env.local (see README).",
  );
}

app.listen(PORT, () => {
  console.log(`[api] listening on http://localhost:${PORT}`);
});
