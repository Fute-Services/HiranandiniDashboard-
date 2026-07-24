"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { JetBrains_Mono } from "next/font/google";
import { landingPathForRole, setSessionCookies } from "@/lib/auth";
import { findUser, USERS, type User } from "@/lib/users";
import { BackButton } from "@/components/BackButton";
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

  // No auth backend yet: match against the mock user directory, and on
  // success mark the session with cookies the middleware/pages check to gate
  // routes and branch on role. Swap findUser for a real sign-in call (Sperto
  // or otherwise) when a backend lands; nothing else here should need to change.
  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const user = findUser(email, password);
    if (!user) {
      setError("Incorrect email or password.");
      return;
    }
    signInAs(user);
  }

  // Demo mode: one click into any of the three roles, no credentials to
  // remember while showing this around. Uses the same session-cookie path a
  // real sign-in does, so there's nothing role-specific screens need to
  // handle differently.
  function signInAs(user: User) {
    setSessionCookies(user.role, user.name, user.email);
    router.push(landingPathForRole(user.role));
    router.refresh();
  }

  return (
    <div className={`${styles.page} ${jetbrains.variable}`}>
      <header className={styles.header}>
        <div className={styles.leftGroup}>
          <BackButton floating={false} />
          <div className={styles.brand}>
            <span className={styles.diamond}>◆</span>
            <span className={`${styles.mono} ${styles.brandName}`}>
              PROPERTY&nbsp;INDEX
            </span>
          </div>
        </div>
        <div className={styles.meta}>
          <div className={`${styles.mono} ${styles.metaCorp}`}>
            HIRANANDANI
          </div>
          <div className={`${styles.mono} ${styles.metaAccess}`}>
            SECURE&nbsp;ACCESS&nbsp;·&nbsp;2026
          </div>
        </div>
      </header>

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
              {USERS.map((user) => {
                const managerName = user.managerEmail
                  ? USERS.find((u) => u.email === user.managerEmail)?.name
                  : undefined;
                return (
                  <button
                    key={user.email}
                    type="button"
                    className={styles.demoButton}
                    onClick={() => signInAs(user)}
                  >
                    <span>
                      {user.name}
                      {managerName && (
                        <span className={styles.demoTeam}> &middot; reports to {managerName}</span>
                      )}
                    </span>
                    <span className={styles.demoRole}>{user.role.replace("_", " ")}</span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
