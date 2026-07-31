"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { JetBrains_Mono } from "next/font/google";
import { landingPathForRole, login } from "@/lib/auth";
import { actorFields, track } from "@/lib/activity";
import { USERS, type User } from "@/lib/users";
import styles from "./login.module.css";

// The design sets its mono labels in JetBrains Mono; the rest of the site uses
// Space Mono, so pull this one in locally rather than adding it site-wide.
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains",
  display: "swap",
});

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

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [kickedNotice, setKickedNotice] = useState(false);

  // Plain browser API rather than useSearchParams(), which would force this
  // client component into a <Suspense> boundary just to read one flag.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("kicked") === "1") {
      setKickedNotice(true);
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

  // Password verification happens server-side (src/app/api/login/route.ts) —
  // this just relays the form and shows whatever the server actually said
  // (e.g. a suspended account gets its own clear message, not a generic
  // "wrong password").
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const result = await login(email, { password });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    afterSignIn(result);
  }

  // Demo mode: one click into any of the three roles, no credentials to
  // remember while showing this around. Goes through the same server-side
  // /api/login endpoint (with `demo: true`, skipping the password check),
  // so there's nothing role-specific screens need to handle differently.
  async function signInAs(user: User) {
    const result = await login(user.email, { demo: true });
    if (result.ok) {
      afterSignIn(result);
    } else {
      setError(result.error);
    }
  }

  function afterSignIn(session: { role: User["role"]; name: string; email: string; sessionId: string }) {
    track({
      sessionId: session.sessionId,
      type: "login",
      label: `${session.name} signed in`,
      leadId: null,
      leadName: null,
      durationMs: null,
      ...actorFields(session.email, session.name),
    });
    router.push(landingPathForRole(session.role));
    router.refresh();
  }

  return (
    <div className={`${styles.page} ${jetbrains.variable}`}>
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
              <h1 className={styles.title}>HIRANANDANI</h1>
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
              SIGN&nbsp;IN&nbsp;↗
            </div>
            <h2 className={styles.formTitle}>Log in to your account</h2>

            {kickedNotice && (
              <p className={styles.notice} role="status">
                You&apos;ve been signed out by your admin or sales manager. Sign in again to continue.
              </p>
            )}

            <form className={styles.fields} onSubmit={onSubmit}>
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

              {error && (
                <p className={`${styles.mono} ${styles.error}`} role="alert">
                  {error}
                </p>
              )}

              <button type="submit" className={`${styles.mono} ${styles.submit}`}>
                SIGN&nbsp;IN&nbsp;<span className={styles.arrow}>↗</span>
              </button>
            </form>

            <div className={styles.demoDivider}>
              <span className={styles.demoLabel}>DEMO&nbsp;MODE</span>
            </div>
            <div className={styles.demoButtons}>
              {USERS.map((user) => (
                <button
                  key={user.email}
                  type="button"
                  className={styles.demoButton}
                  onClick={() => signInAs(user)}
                >
                  <span>{user.name}</span>
                  <span className={styles.demoRole}>{user.role.replace("_", " ")}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
