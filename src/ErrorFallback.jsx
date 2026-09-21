/**
 * What the whole app falls back to when a render throws — the replacement for
 * Next.js's `global-error.tsx`.
 *
 * Deliberately plain and dependency-free: this renders when the tree above it
 * has already failed, so it reads its colours straight off the design tokens
 * in index.css and imports nothing that could fail with it.
 *
 * "Reload" rather than a "try again" that re-renders in place: whatever state
 * caused the throw is still in memory, and on a showroom floor the fastest
 * honest recovery is a fresh load back to the login.
 */
export function ErrorFallback({ error, resetError }) {
  return (
    <div
      role="alert"
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "24px",
        background: "var(--surface-0, #0a0b0c)",
        color: "var(--ink, #f2efe8)",
        fontFamily: "var(--ui, system-ui, sans-serif)",
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: "34rem", display: "grid", gap: "12px" }}>
        <h1 style={{ fontFamily: "var(--serif, Georgia, serif)", fontSize: "1.75rem", margin: 0 }}>
          Something went wrong
        </h1>
        <p style={{ margin: 0, opacity: 0.68, lineHeight: 1.5 }}>
          The screen couldn&apos;t be drawn. Reloading usually clears it — if it
          keeps happening, tell whoever set this up.
        </p>
        {/* The message only, never the stack: this can be on a screen a
            customer is standing in front of. The full error is already on its
            way to Sentry. */}
        {error?.message && (
          <p
            style={{
              margin: 0,
              fontFamily: "var(--code, monospace)",
              fontSize: "0.8125rem",
              opacity: 0.5,
              wordBreak: "break-word",
            }}
          >
            {error.message}
          </p>
        )}
        <div style={{ display: "flex", gap: "10px", justifyContent: "center", marginTop: "8px" }}>
          <button
            type="button"
            onClick={() => window.location.replace("/login")}
            style={buttonStyle}
          >
            Reload
          </button>
          {resetError && (
            <button type="button" onClick={resetError} style={{ ...buttonStyle, opacity: 0.7 }}>
              Try again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const buttonStyle = {
  padding: "10px 20px",
  borderRadius: "999px",
  border: "1px solid rgba(242, 239, 232, 0.2)",
  background: "transparent",
  color: "inherit",
  font: "inherit",
  fontSize: "0.875rem",
  cursor: "pointer",
};
