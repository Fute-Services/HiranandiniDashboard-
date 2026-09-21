import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

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
        target: `http://localhost:${API_PORT}`,
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
