"use client";

import { useEffect, useRef, useState } from "react";
import { landingPathForRole, login, type LoginCredentials } from "@/lib/auth";
import { actorFields, track } from "@/lib/activity";
import { useNavigationLock } from "@/lib/useNavigationLock";
import type { Role } from "@/lib/users";
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
 * against Sperto, the client's CRM (see src/app/api/login/route.ts) — an email
 * Sperto doesn't have is a rejection, which is what makes a password
 * unnecessary on a screen a customer is standing in front of. The lead is
 * asked for on the next screen, `/session/start`.
 *
 * "admin" is the email + password form, kept behind a link because admins and
 * sales managers get the reporting dashboards and those are worth a real
 * credential. It is deliberately not Sperto-gated: an outage at the CRM must
 * not lock an admin out of their own dashboard.
 */
type Mode = "staff" | "admin";

/**
 * One-click sign-in for showing the app around, one button per role.
 *
 * These go through the ordinary doors — the staff one sends its email exactly
 * as the form does, the other two send the real password — so there is no
 * bypass in `/api/login` for a demo to walk through. The credentials are the
 * published demo accounts (README, `src/lib/users.ts`); they are worth nothing
 * beyond a demo instance.
 *
 * Once Sperto is configured, the staff button only works if Sperto knows that
 * address — which is correct: at that point Sperto owns the staff list, and a
 * demo button that could talk its way past it would not be demonstrating this
 * app's login at all. Delete this block for the client's own deployment.
 */
const DEMO_ACCOUNTS: { email: string; password?: string; name: string; role: string }[] = [
  { email: "staff@futeservices.com", name: "Sales Staff", role: "sales staff" },
];

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("staff");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [signedOutNotice, setSignedOutNotice] = useState<"kicked" | "replaced" | null>(null);
  /** Which sign-in is in flight — "signin" for the form, or a demo account's
   * email. Everything on the card is disabled meanwhile, so a slow network
   * can't turn into two parallel logins — and it self-releases, so a sign-in
   * that never resolves gives the card back instead of freezing it (see
   * lib/useNavigationLock). */
  const [pending, setPending] = useNavigationLock<string>();
  /** `pending` drives what the card *shows*, and it lets go on its own if a
   * sign-in never resolves — which is what keeps a dropped request from
   * freezing the card, but also means it can't be the thing that guarantees
   * one request at a time. This ref is: it's only ever cleared by the request
   * actually settling, so a second click after the visual lock has lifted
   * still can't open a parallel login. */
  const requestInFlight = useRef(false);

  // Plain browser API rather than useSearchParams(), which would force this
  // client component into a <Suspense> boundary just to read one flag.
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

  function switchMode(next: Mode) {
    if (pending) return;
    setMode(next);
    setError("");
  }

  // Credential checking happens server-side (src/app/api/login/route.ts) —
  // this just relays what was typed and shows whatever the server actually
  // said (e.g. a suspended account gets its own clear message, not a generic
  // "wrong password"). Shared by the form and the demo buttons so the two
  // cannot drift apart on the one flow where getting it wrong strands
  // somebody on a disabled card.
  async function attemptSignIn(credentials: LoginCredentials, lockKey: string) {
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

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Staff send the email alone — Sperto is what verifies it, server-side.
    void attemptSignIn(mode === "admin" ? { email, password } : { email }, "signin");
  }

  function afterSignIn(session: { role: Role; name: string; email: string; sessionId: string }) {
    track({
      sessionId: session.sessionId,
      type: "login",
      label: `${session.name} signed in`,
      leadId: null,
      leadName: null,
      durationMs: null,
      ...actorFields(session.email, session.name),
    });
    // A hard navigation, for the same reason sign-out uses one (see
    // lib/sign-out.ts): /api/login has just set the httpOnly auth cookie that
    // `proxy.ts` gates every destination on, and a client-side push races
    // that — it was pushing and calling router.refresh() in the same tick,
    // and a refresh of the route being navigated away from can supersede the
    // push. When it did, the user stayed on a login card with every button
    // disabled behind `pending`, and reloading was the only way through
    // (which then worked, because by then the cookie was there). A full load
    // can't race itself, and it guarantees this page unmounts, so `pending`
    // has nothing left to strand. It also lets the root layout's watchers
    // re-read the session they mounted too early to see.
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
              <h1 className={styles.title}>FUTE SERVICES</h1>
              <p className={styles.lede}>
                Sign in to manage your property portfolio, track projects and
                access secure documents.
              </p>
            </div>
            <div className={styles.asideFoot}>
              <div className={styles.rule} />
              <div className={`${styles.mono} ${styles.stats}`}>
                <span>06&nbsp;PROJECTS</span>
                <span>2026&nbsp;EDITION</span>
              </div>
            </div>
          </section>

          <section className={styles.form}>
            <div className={`${styles.mono} ${styles.formEyebrow}`}>
              {isStaff ? "SALES STAFF ↗" : "ADMIN / MANAGER ↗"}
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
                    placeholder="you@futeservices.com or PDPL0349"
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
                      placeholder="you@futeservices.com"
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

              {/* Disabled for any sign-in in flight, but only *spinning* for
                  its own — a demo button's spinner belongs on that button. */}
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
                    {isStaff ? "CONTINUE" : "SIGN IN"}&nbsp;
                    <span className={styles.arrow}>↗</span>
                  </>
                )}
              </button>
            </form>

            <button
              type="button"
              className={`${styles.mono} ${styles.switchMode}`}
              onClick={() => switchMode(isStaff ? "admin" : "staff")}
              disabled={pending !== null}
            >
              {isStaff ? "Admin / Manager login →" : "← Back to sales staff login"}
            </button>

            {/* All three shown in both modes: the point of these is to reach
                any role in one tap, and hiding two of them behind the door
                switch would make that two taps for no reason. */}
            <div className={styles.demoDivider}>
              <span className={`${styles.mono} ${styles.demoLabel}`}>DEMO&nbsp;ACCOUNTS</span>
            </div>
            <div className={styles.demoButtons}>
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  key={account.email}
                  type="button"
                  className={`${styles.mono} ${styles.demoButton}`}
                  onClick={() =>
                    void attemptSignIn(
                      account.password
                        ? { email: account.email, password: account.password }
                        : { email: account.email },
                      account.email,
                    )
                  }
                  disabled={pending !== null}
                  aria-busy={pending === account.email}
                >
                  <span className={styles.demoIdentity}>
                    <span className={styles.demoName}>{account.name}</span>
                    <span className={styles.demoEmail}>{account.email}</span>
                  </span>
                  <span className={styles.demoRole}>
                    {pending === account.email ? (
                      <span className={styles.demoPending}>
                        <Spinner size={11} />
                        SIGNING IN…
                      </span>
                    ) : (
                      account.role
                    )}
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
