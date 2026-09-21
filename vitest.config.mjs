import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Deliberately minimal: no jsdom, no React testing library, no setup file.
 * What is worth testing here is the seam with Sperto — a third party whose
 * server answers 200 for errors, labels JSON as text/html and has an
 * undocumented success shape — and the project-time accounting that feeds
 * their `project_time` field. Neither needs a DOM.
 *
 * The `server-only` alias the Next.js build needed is gone: server modules
 * now live under `server/` and are never part of the browser bundle, so
 * there is nothing to stub out.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.js", "server/**/*.test.js", "test/**/*.test.js"],
  },
});
