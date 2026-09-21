import { createApp, warnIfUnconfigured } from "./app.js";

/**
 * Runs the API as a long-lived process — local development behind the Vite
 * dev proxy (`npm run dev`), and any ordinary Node host, where this same
 * process also serves the built `dist/` so there is one origin and no proxy
 * to configure.
 *
 * On Vercel nothing here runs: `api/[...path].js` is the entry point there,
 * and it takes the same app without the listening.
 */
const PORT = Number(process.env.API_PORT ?? 3001);

warnIfUnconfigured();

createApp().listen(PORT, () => {
  console.log(`[api] listening on http://localhost:${PORT}`);
});
