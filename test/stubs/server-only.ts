/**
 * No-op stand-in for the `server-only` package, aliased in by
 * vitest.config.ts.
 *
 * The real package throws on import outside a React Server Component graph.
 * That is the whole point of it in src/lib/sperto.ts — importing that module
 * from a client component must be a build error, because SPERTO_API_KEY must
 * never reach a browser. It also means a plain Node test runner cannot import
 * the module at all, hence this stub. It intentionally does nothing: the guard
 * still holds everywhere it matters, and the test process is not a browser.
 */
export {};
