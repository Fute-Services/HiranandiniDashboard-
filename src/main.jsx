import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./App";
import { ErrorFallback } from "./ErrorFallback";
import "./index.css";

/**
 * Sentry, when a DSN is configured. `VITE_`-prefixed because that is what
 * Vite exposes to the browser bundle — an unprefixed variable stays on the
 * server, which is the right default for everything else in `.env.local` and
 * the wrong one for this.
 *
 * Unconfigured is the ordinary local case, not a degraded one: `init` is
 * simply skipped and the boundary below still catches and renders.
 */
const dsn = import.meta.env.VITE_SENTRY_DSN;
if (dsn) {
  Sentry.init({ dsn, tracesSampleRate: 1.0 });
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    {/* Replaces Next.js's global-error.tsx: one boundary around the whole
        tree, reporting to Sentry and showing something a person on a showroom
        floor can act on rather than a blank page. */}
    <Sentry.ErrorBoundary fallback={ErrorFallback} showDialog={false}>
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
