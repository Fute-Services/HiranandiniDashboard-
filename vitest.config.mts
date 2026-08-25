import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * First test setup in this repo. Deliberately minimal: no jsdom, no React
 * testing library, no setup file. What is worth testing here is the seam with
 * Sperto — a third party whose server answers 200 for errors, labels JSON as
 * text/html and has an undocumented success shape — and none of that needs a
 * DOM.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` throws by design outside a React Server Component
      // graph, which is exactly what makes it useful in src/lib/sperto.ts and
      // exactly what stops that module being importable from a test. The stub
      // is a no-op, so the import keeps its build-time meaning in the app and
      // simply disappears here.
      "server-only": fileURLToPath(new URL("./test/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
  },
});
