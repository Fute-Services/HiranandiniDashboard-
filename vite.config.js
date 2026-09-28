import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import http from "node:http";

/**
 * Two processes in development, one origin in the browser.
 *
 * The API is a plain Express server (see `server/`), not part of this build —
 * so every `/api/*` call the app makes is proxied to it. That is what keeps
 * the whole app same-origin: the session cookie is httpOnly and SameSite=Lax,
 * and the API's own CSRF check (server/lib/csrf.js) compares Origin against
 * the request host. Talking to the API on its own port directly would break
 * both.
 */
const API_PORT = process.env.API_PORT ?? 3001;

/**
 * One pool of reused connections to the API. Without it the proxy opens a
 * fresh TCP connection per request, and the showcase polls every couple of
 * seconds — on Windows the closed ones pile up until connecting fails with
 * EADDRINUSE and every /api call errors. 127.0.0.1 rather than "localhost"
 * so each connect is one attempt, not an IPv6-then-IPv4 pair.
 */
const apiAgent = new http.Agent({ keepAlive: true, maxSockets: 32 });

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${API_PORT}`,
        changeOrigin: false,
        agent: apiAgent,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
