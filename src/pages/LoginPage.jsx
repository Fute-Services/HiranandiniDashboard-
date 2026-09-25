import { useEffect, useRef, useState } from "react";
import { landingPathForRole, login, REPORTING_ENABLED } from "@/lib/auth";
import { actorFields, track } from "@/lib/activity";
import { recordLoginIn } from "@/lib/session";
import { railProjects } from "@/data/properties";
import { useNavigationLock } from "@/lib/useNavigationLock";
import { Spinner } from "@/components/Spinner";
import styles from "./login.module.css";

const Eye = (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const EyeOff = (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M6.6 6.6A18.5 18.5 0 0 0 1 12s4 8 11 8a9.1 9.1 0 0 0 5.4-1.6" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    <path d="m1 1 22 22" />
  </svg>
);

/**
 * One screen, two doors.
 *
 * "staff" is the one that matters and the one that's shown first: a sales
 * staff member types their email and nothing else. The server checks it
 * against Sperto, the client's CRM (see server/routes/login.js) — an email
 * Sperto doesn't have is a rejection, which is what makes a password
 * unnecessary on a screen a customer is standing in front of. The lead is
 * asked for on the next screen, `/session/start`.
 *
 * "admin" is the email + password form, kept behind a link because admins and
 * sales managers get the reporting dashboards and those are worth a real
 * credential. It is deliberately not Sperto-gated: an outage at the CRM must
 * not lock an admin out of their own dashboard.
 */
export default function LoginPage() {
  const [mode, setMode] = useState("staff");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [signedOutNotice, setSignedOutNotice] = useState(null);
  /** Which sign-in is in flight ("signin"), or null. Everything on the card is disabled meanwhile, so a slow network
   * can't turn into two parallel logins — and it self-releases, so a sign-in
   * that never resolves gives the card back instead of freezing it (see
   * lib/useNavigationLock). */
  const [pending, setPending] = useNavigationLock();
  /** `pending` drives what the card *shows*, and it lets go on its own if a
   * sign-in never resolves — which is what keeps a dropped request from
   * freezing the card, but also means it can't be the thing that guarantees
   * one request at a time. This ref is: it's only ever cleared by the request
   * actually settling, so a second click after the visual lock has lifted
   * still can't open a parallel login. */
  const requestInFlight = useRef(false);

  // Plain browser API rather than react-router's useSearchParams: this reads
  // one flag once, on mount, and then rewrites the URL out from under itself.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("kicked") === "1") {
      setSignedOutNotice("kicked");
      window.history.replaceState(null, "", window.location.pathname);
    } else if (params.get("replaced") === "1") {
      setSignedOutNotice("replaced");
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  // .page clips its own content, but the document itself (html/body) can still
  // scroll if anything is a hair taller than the viewport. Lock it at the
  // document level while this page is mounted, restore on navigate-away.
  useEffect(() => {
    const { overflow } = document.body.style;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = "";
      document.body.style.overflow = overflow;
    };
  }, []);

  function switchMode(next) {
    if (pending) return;
    setMode(next);
    setError("");
  }

  // Credential checking happens server-side (server/routes/login.js) — this
  // just relays what was typed and shows whatever the server actually said
  // (e.g. a suspended account gets its own clear message, not a generic
  // "wrong password").
  async function attemptSignIn(credentials, lockKey) {
    if (pending || requestInFlight.current) return;
    requestInFlight.current = true;
    setPending(lockKey);
    // login() already reports every failure as `ok: false`; the try is for
    // anything after it (tracking, the redirect) so a throw there can't
    // strand the button in "SIGNING IN…" with no way back.
    try {
      const result = await login(credentials);
      if (!result.ok) {
        setError(result.error);
        setPending(null);
        return;
      }
      // Deliberately stays pending on success: the redirect that follows
      // takes its own moment, and dropping the spinner first would leave the
      // button looking idle while the app is still navigating.
      afterSignIn(result);
    } catch {
      setError("Something went wrong signing in. Please try again.");
      setPending(null);
    } finally {
      requestInFlight.current = false;
    }
  }

  function onSubmit(e) {
    e.preventDefault();
    // Staff send the email alone — Sperto is what verifies it, server-side.
    void attemptSignIn(mode === "admin" ? { email, password } : { email }, "signin");
  }

  function afterSignIn(session) {
    track({
      sessionId: session.sessionId,
      type: "login",
      label: `${session.name} signed in`,
      leadId: null,
      leadName: null,
      durationMs: null,
      ...actorFields(session.email, session.name),
    });
    // Sperto's "IN" goes at sign-in; its "OUT" at sign-out (lib/sign-out.js).
    // keepalive, so the redirect below doesn't cancel it.
    recordLoginIn();
    // A hard navigation, for the same reason sign-out uses one (see
    // lib/sign-out.js): /api/login has just set the httpOnly auth cookie the
    // route guards ask the server about, and a client-side navigate races
    // that — the guard re-checks on the new route and can still be holding
    // the pre-login answer. When it did, the user stayed on a login card with
    // every button disabled behind `pending`, and reloading was the only way
    // through (which then worked, because by then the cookie was there). A
    // full load can't race itself, and it guarantees this page unmounts, so
    // `pending` has nothing left to strand. It also lets the app shell's
    // watchers re-read the session they mounted too early to see.
    window.location.replace(landingPathForRole(session.role));
  }

  const isStaff = mode === "staff";

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <div className={styles.card}>
          <section className={styles.aside}>
            <div className={styles.asideTop}>
              <span className={`${styles.mono} ${styles.eyebrow}`}>
                PORTAL&nbsp;ACCESS
              </span>
            </div>
            <div>
              <div className={`${styles.mono} ${styles.welcome}`}>
                WELCOME&nbsp;BACK
              </div>
              <h1 className={styles.title}>HIRANANDANI DASHBOARD</h1>
              <p className={styles.lede}>
                Sign in to manage your property portfolio, track projects and
                access secure documents.
              </p>
            </div>
            <div className={styles.asideFoot}>
              <div className={styles.rule} />
              <div className={`${styles.mono} ${styles.stats}`}>
                {/* Counted off the rail rather than typed, because this drifted
                    once already: it read "06" while the showcase had been
                    offering seven for a while. Adding a project to
                    data/properties.js now updates this on its own. */}
                <span>{String(railProjects.length).padStart(2, "0")}&nbsp;PROJECTS</span>
                <span>2026&nbsp;EDITION</span>
              </div>
            </div>
          </section>

          <section className={styles.form}>
            <div className={`${styles.mono} ${styles.formEyebrow}`}>
              {isStaff ? "SALES STAFF ↗" : "ADMIN / MANAGER ↗"}
            </div>
            <h2 className={styles.formTitle}>
              {isStaff ? "Start a presentation" : "Log in to your account"}
            </h2>

            {signedOutNotice === "kicked" && (
              <p className={styles.notice} role="status">
                You&apos;ve been signed out by your admin or sales manager. Sign in again to continue.
              </p>
            )}
            {signedOutNotice === "replaced" && (
              <p className={styles.notice} role="status">
                You were signed out because your account was logged in on another device.
              </p>
            )}
            <form className={styles.fields} onSubmit={onSubmit}>
              {isStaff ? (
                <label className={styles.field}>
                  <span className={`${styles.mono} ${styles.label}`}>
                    EMAIL&nbsp;OR&nbsp;SALES&nbsp;ID
                  </span>
                  {/* type="text", not "email" — a Sales ID like "PDPL0349" has no
                      "@", and the browser's own email validation would block
                      submitting it before this ever reaches /api/login, which
                      is what actually tells the two apart (see that route's
                      resolveEmailFromSalesId). */}
                  <input
                    type="text"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (error) setError("");
                    }}
                    placeholder="you@hiranandani.com or PDPL0349"
                    autoComplete="username"
                    required
                    className={styles.input}
                  />
                </label>
              ) : (
                <>
                  <label className={styles.field}>
                    <span className={`${styles.mono} ${styles.label}`}>
                      EMAIL&nbsp;ADDRESS
                    </span>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        if (error) setError("");
                      }}
                      placeholder="you@hiranandani.com"
                      autoComplete="email"
                      required
                      className={styles.input}
                    />
                  </label>

                  <label className={styles.field}>
                    <span className={`${styles.mono} ${styles.label}`}>
                      PASSWORD
                    </span>
                    <div className={styles.inputWrap}>
                      <input
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          if (error) setError("");
                        }}
                        placeholder="••••••••"
                        autoComplete="current-password"
                        required
                        className={`${styles.input} ${styles.inputPassword}`}
                      />
                      <button
                        type="button"
                        className={styles.eye}
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        aria-pressed={showPassword}
                      >
                        {showPassword ? EyeOff : Eye}
                      </button>
                    </div>
                  </label>
                </>
              )}

              {error && (
                <p className={`${styles.mono} ${styles.error}`} role="alert">
                  {error}
                </p>
              )}

              <button
                type="submit"
                className={`${styles.mono} ${styles.submit}`}
                disabled={pending !== null}
                aria-busy={pending === "signin"}
              >
                {pending === "signin" ? (
                  <>
                    <Spinner size={14} />
                    SIGNING&nbsp;IN…
                  </>
                ) : (
                  <>
                    {isStaff ? "CONTINUE" : "SIGN IN"}&nbsp;
                    <span className={styles.arrow}>↗</span>
                  </>
                )}
              </button>
            </form>

            {/* The password door is the only way to reach the admin and
                manager dashboards, and those are out of scope for this
                release (see auth.js's REPORTING_ENABLED). Hidden rather than
                removed: /api/login refuses both roles anyway, so this is the
                cosmetic half of the same switch. */}
            {REPORTING_ENABLED && (
              <button
                type="button"
                className={`${styles.mono} ${styles.switchMode}`}
                onClick={() => switchMode(isStaff ? "admin" : "staff")}
                disabled={pending !== null}
              >
                {isStaff ? "Admin / Manager login →" : "← Back to sales staff login"}
              </button>
            )}

          </section>
        </div>
      </main>
    </div>
  );
}
