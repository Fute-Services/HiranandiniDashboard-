import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

/**
 * Replaces `eslint-config-next`, which came with the framework and carried
 * rules about things this app no longer has (`next/image`, `next/link`, the
 * app-router file conventions). What is left is what actually applies: the
 * rules of hooks, and a fast-refresh check for the component files.
 *
 * The browser and the server halves get different globals, which is the one
 * thing worth keeping strict — `document` in a route handler or `process` in
 * a component are both real mistakes now that the two run in different
 * places.
 */
export default [
  { ignores: ["dist/**", "node_modules/**", ".data/**"] },

  // Client — src/, in a browser.
  {
    files: ["src/**/*.{js,jsx}"],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.browser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "no-unused-vars": ["error", { varsIgnorePattern: "^[A-Z_]", argsIgnorePattern: "^_" }],

      // These three are new in eslint-plugin-react-hooks v7 and were not
      // enforced by the framework config this replaces. They fire on patterns
      // that predate the move and are deliberate — a `setState` in an effect
      // that reads `window.location.search` once on mount, an interval that
      // ticks a clock, a `Date.now()` read while rendering a "how long ago"
      // column. Each is worth revisiting on its own terms; none of them is a
      // reason for `npm run lint` to fail on code that behaves exactly as it
      // did before. Warnings keep them visible without pretending the
      // conversion introduced them.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  // Server — server/ and the db scripts, in Node.
  {
    files: ["server/**/*.js", "scripts/**/*.mjs"],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node, fetch: "readonly", crypto: "readonly" },
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": ["error", { argsIgnorePattern: "^_|^next$" }],
    },
  },

  // Tests run under Vitest in Node, and stub browser globals themselves.
  {
    files: ["**/*.test.js"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
];
