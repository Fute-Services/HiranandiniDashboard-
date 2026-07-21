"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clearSessionCookies, getSession, LOGIN_PATH, SPACE_PATH } from "@/lib/auth";
import { properties } from "@/data/properties";
import { createWalkInLead } from "@/lib/leads";
import { getSessionLog, type SessionSummary } from "@/lib/reports";
import { setActiveSession } from "@/lib/session";
import { ImageSlot } from "./ImageSlot";
import styles from "./SessionReports.module.css";

function formatDuration(ms: number) {
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "<1 min";
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/** "0:42" style — how far into the session an event happened. */
function relativeTime(atMs: number, startedAtMs: number) {
  const totalSec = Math.max(0, Math.round((atMs - startedAtMs) / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function isToday(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

/**
 * The reporting view shared by both `/admin/dashboard` and
 * `/manager/dashboard` (questionnaire §6): a projects overview, Today's
 * Presentations, total session duration, and which property cards were
 * opened and when — read straight from `src/lib/reports.ts`'s local session
 * log (see that file's comment for why `localStorage`, not a real API,
 * backs this in V1). A sales manager only sees sessions from their own team
 * (`SessionSummary.managerEmail` matching the viewer's own email, from
 * `src/lib/users.ts`'s `managerEmail` hierarchy); an admin always sees
 * everyone. `showProjects` defaults off since a generic caller may not want it.
 */
export function SessionReports({
  brandLabel,
  title,
  showProjects = false,
}: {
  brandLabel: string;
  title: string;
  showProjects?: boolean;
}) {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);

  useEffect(() => {
    const all = getSessionLog();
    const viewer = getSession();
    const scoped =
      viewer?.role === "sales_manager"
        ? all.filter((s) => s.managerEmail === viewer.email)
        : all;
    setSessions([...scoped].reverse());
  }, []);

  const signOut = useCallback(() => {
    clearSessionCookies();
    router.push(LOGIN_PATH);
    router.refresh();
  }, [router]);

  /** Admin/manager get a direct preview — no lead lookup, unlike the sales
   * staff flow (`/session/start`) this skips past. */
  const openDashboard = useCallback(() => {
    setActiveSession(createWalkInLead());
    router.push(SPACE_PATH);
  }, [router]);

  const list = sessions ?? [];
  const today = list.filter((s) => isToday(s.startedAt));
  const avgMs =
    list.length > 0 ? list.reduce((sum, s) => sum + s.totalTimeMs, 0) / list.length : 0;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.leftGroup}>
          <div className={styles.brand}>
            <div className={styles.diamond} />
            <span className={styles.brandName}>{brandLabel}</span>
          </div>
        </div>
        <div className={styles.headerRight}>
          <button type="button" className={styles.dashboardLink} onClick={openDashboard}>
            View Dashboard&nbsp;&#8599;
          </button>
          <button type="button" className={styles.signout} onClick={signOut}>
            Log out
          </button>
        </div>
      </header>

      <div className={styles.eyebrow}>Reporting</div>
      <h1 className={styles.title}>{title}</h1>

      <div className={styles.statRow}>
        <div className={styles.stat}>
          <div className={styles.statLabel}>Today&apos;s Presentations</div>
          <div className={styles.statValue}>{today.length}</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statLabel}>Total Presentations</div>
          <div className={styles.statValue}>{list.length}</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statLabel}>Avg. Session Time</div>
          <div className={styles.statValue}>{list.length ? formatDuration(avgMs) : "—"}</div>
        </div>
      </div>

      {showProjects && (
        <>
          <div className={styles.sectionTitle}>Projects</div>
          <div className={styles.projectGrid}>
            {properties.map((property) => (
              <a
                key={property.slug}
                className={styles.projectCard}
                href={property.href}
                target="_blank"
                rel="noreferrer"
              >
                <div className={styles.projectMedia}>
                  <ImageSlot
                    src={property.image}
                    placeholder={`${property.name || "Property"} image`}
                    alt={`${property.name || "Property"}, ${property.location}`}
                  />
                </div>
                <div className={styles.projectBody}>
                  <div className={styles.projectName}>{property.name}</div>
                  <div className={styles.projectLocation}>{property.location}</div>
                </div>
              </a>
            ))}
          </div>
        </>
      )}

      <div className={styles.sectionTitle}>Recent Customers</div>

      {sessions === null ? null : list.length === 0 ? (
        <p className={styles.empty}>
          No sessions logged yet — they show up here once sales staff
          complete one (End Session on the showcase screen).
        </p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Sales Staff</th>
                <th>Started</th>
                <th>Duration</th>
                <th>What Was Shown</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.leadName}
                    <br />
                    <span style={{ opacity: 0.5, fontSize: 11.5 }}>{s.leadId}</span>
                  </td>
                  <td>{s.staffName}</td>
                  <td>{new Date(s.startedAt).toLocaleString()}</td>
                  <td>{formatDuration(s.totalTimeMs)}</td>
                  <td>
                    <div className={styles.path}>
                      {s.events.length === 0 ? (
                        <span style={{ opacity: 0.4, fontSize: 12.5 }}>
                          VR tour only — no property cards opened
                        </span>
                      ) : (
                        s.events.map((e, i) => (
                          <span key={`${e.label}-${i}`} className={styles.pathStep}>
                            {e.label} &middot; {relativeTime(e.at, s.startedAt)}
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
