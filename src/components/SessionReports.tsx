"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clearSessionCookies, getSession, LOGIN_PATH, SPACE_PATH } from "@/lib/auth";
import { getBlockedProjectsFor, kickStaff, setProjectBlockedFor } from "@/lib/controls";
import { createWalkInLead } from "@/lib/leads";
import { getSessionLog, type SessionSummary } from "@/lib/reports";
import { setActiveSession } from "@/lib/session";
import { USERS } from "@/lib/users";
import { properties } from "@/data/properties";
import styles from "./SessionReports.module.css";

function formatDuration(ms: number) {
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "<1 min";
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/** "0:42" style, showing how far into the session an event happened. */
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

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
}

const TREND_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight-aligned count of sessions started on each of the last
 * TREND_DAYS days (oldest first), for the trend chart below. */
function buildDayCounts(list: SessionSummary[]) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startOfToday = today.getTime();

  return Array.from({ length: TREND_DAYS }, (_, i) => {
    const dayStart = startOfToday - (TREND_DAYS - 1 - i) * DAY_MS;
    const count = list.filter(
      (s) => s.startedAt >= dayStart && s.startedAt < dayStart + DAY_MS,
    ).length;
    return {
      label: new Date(dayStart).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      }),
      count,
    };
  });
}

/** Top property cards opened across every session's event log, most-shown
 * first. Events read "Visited <name>" (src/lib/session.ts's logSessionEvent
 * call site in PropertyShowcase.tsx); strip that prefix for display. */
function buildTopProperties(list: SessionSummary[], max = 6) {
  const counts = new Map<string, number>();
  for (const s of list) {
    for (const e of s.events) {
      const label = e.label.replace(/^Visited /, "");
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, max);
}

const iconProps = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

const CalendarIcon = (
  <svg {...iconProps}>
    <rect x="3" y="5" width="18" height="16" rx="2.5" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </svg>
);

const UsersIcon = (
  <svg {...iconProps}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
    <path d="M16 8.2a3.2 3.2 0 1 1 0 6.4M21.5 20c0-2.9-1.9-5.1-4.5-5.8" />
  </svg>
);

const ClockIcon = (
  <svg {...iconProps}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.5 2" />
  </svg>
);

const EmptyIcon = (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="15" rx="2.5" />
    <path d="M3 9h18M8 14h3" />
  </svg>
);

/** Column chart, one series (session count), so no legend: the card title
 * already names what's plotted. Every bar carries its own hover/focus
 * tooltip; the tallest bar is direct-labeled so the peak reads without
 * hovering at all. */
function TrendChart({ data }: { data: { label: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const peakIndex = data.reduce(
    (best, d, i) => (d.count > data[best].count ? i : best),
    0,
  );

  return (
    <div className={styles.chartCard}>
      <div className={styles.chartTitle}>Presentations &middot; Last {TREND_DAYS} Days</div>
      <div className={styles.trendChart}>
        {data.map((d, i) => (
          <div key={d.label} className={styles.trendCol} tabIndex={0}>
            {i === peakIndex && d.count > 0 && (
              <span className={styles.trendPeakLabel}>{d.count}</span>
            )}
            <div className={styles.trendTrack}>
              <div
                className={styles.trendBar}
                style={{ height: `${(d.count / max) * 100}%` }}
              />
            </div>
            <span className={styles.trendTooltip}>
              {d.count} on {d.label}
            </span>
            <span
              className={styles.trendAxisLabel}
              style={i % 2 === 0 ? undefined : { visibility: "hidden" }}
            >
              {d.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Horizontal bars ranked by count — comparison, not trend, so a bar chart
 * rather than the column form above. Room on this axis to direct-label
 * every value, so no hover is needed to read it (hover still lifts the bar
 * as a response cue). */
function TopPropertiesChart({ data }: { data: { label: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));

  return (
    <div className={styles.chartCard}>
      <div className={styles.chartTitle}>Most-Shown Properties</div>
      {data.length === 0 ? (
        <p className={styles.chartEmpty}>No property cards opened yet.</p>
      ) : (
      <div className={styles.propBars}>
        {data.map((d) => (
          <div key={d.label} className={styles.propRow} tabIndex={0}>
            <span className={styles.propLabel}>{d.label}</span>
            <div className={styles.propTrack}>
              <div
                className={styles.propBar}
                style={{ width: `${(d.count / max) * 100}%` }}
              />
            </div>
            <span className={styles.propValue}>{d.count}</span>
          </div>
        ))}
      </div>
      )}
    </div>
  );
}

/** Admin/manager controls: force-logout a sales staff member (their own tab
 * polls for this, see PropertyShowcase + lib/controls.ts), and, with many
 * sales staff on the roster, pick one and set which projects are active vs.
 * blocked just for them (per-staff, not one global switch for everyone).
 * Sales managers only see and control their own team. */
function ControlsPanel({ staff }: { staff: { email: string; name: string }[] }) {
  const [kicked, setKicked] = useState<Set<string>>(new Set());
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string[]>([]);

  // Default to the first staff member so the Projects card never sits empty
  // with just a "pick someone" placeholder when there's an obvious one to show.
  useEffect(() => {
    if (!selectedEmail && staff.length > 0) setSelectedEmail(staff[0].email);
  }, [staff, selectedEmail]);

  useEffect(() => {
    if (!selectedEmail) {
      setBlocked([]);
      return;
    }
    let cancelled = false;
    getBlockedProjectsFor(selectedEmail).then((slugs) => {
      if (!cancelled) setBlocked(slugs);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedEmail]);

  const forceLogout = (email: string) => {
    kickStaff(email);
    setKicked((prev) => new Set(prev).add(email));
  };

  const toggleBlocked = (slug: string) => {
    if (!selectedEmail) return;
    const next = !blocked.includes(slug);
    setProjectBlockedFor(selectedEmail, slug, next);
    setBlocked((prev) => (next ? [...prev, slug] : prev.filter((s) => s !== slug)));
  };

  const selectedStaff = staff.find((s) => s.email === selectedEmail) ?? null;

  return (
    <div className={styles.controlsStack}>
      <div className={styles.chartCard}>
        <div className={styles.chartTitle}>Sales Staff</div>
        {staff.length === 0 ? (
          <p className={styles.chartEmpty}>No sales staff on this team yet.</p>
        ) : (
          <div className={styles.staffList}>
            {staff.map((s) => (
              <div
                key={s.email}
                className={`${styles.staffRow} ${styles.staffRowSelectable} ${
                  s.email === selectedEmail ? styles.staffRowSelected : ""
                }`}
                tabIndex={0}
                role="button"
                aria-pressed={s.email === selectedEmail}
                onClick={() => setSelectedEmail(s.email)}
                onKeyDown={(e) => e.key === "Enter" && setSelectedEmail(s.email)}
              >
                <div>
                  <div className={styles.staffName}>{s.name}</div>
                  <div className={styles.staffEmail}>{s.email}</div>
                </div>
                <button
                  type="button"
                  className={styles.kickBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    forceLogout(s.email);
                  }}
                >
                  {kicked.has(s.email) ? "Signal Sent" : "Force Logout"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className={styles.chartCard}>
        <div className={styles.chartTitle}>
          Projects{selectedStaff ? ` · ${selectedStaff.name}` : ""}
        </div>
        {!selectedStaff ? (
          <p className={styles.chartEmpty}>Select a sales staff member to manage their projects.</p>
        ) : (
          <div className={styles.staffList}>
            {properties.map((p) => {
              const isBlocked = blocked.includes(p.slug);
              return (
                <div key={p.slug} className={styles.staffRow}>
                  <div className={styles.staffName}>{p.name}</div>
                  <button
                    type="button"
                    className={`${styles.blockBtn} ${isBlocked ? styles.blockBtnBlocked : ""}`}
                    onClick={() => toggleBlocked(p.slug)}
                  >
                    {isBlocked ? "Blocked" : "Active"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The reporting view shared by both `/admin/dashboard` and
 * `/manager/dashboard` (questionnaire §6): a projects overview, Today's
 * Presentations, total session duration, and which property cards were
 * opened and when, read straight from `src/lib/reports.ts`'s local session
 * log (see that file's comment for why `localStorage`, not a real API,
 * backs this in V1). A sales manager only sees sessions from their own team
 * (`SessionSummary.managerEmail` matching the viewer's own email, from
 * `src/lib/users.ts`'s `managerEmail` hierarchy); an admin always sees
 * everyone.
 */
export function SessionReports({
  brandLabel,
  title,
}: {
  brandLabel: string;
  title: string;
}) {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [viewer, setViewer] = useState<ReturnType<typeof getSession>>(null);

  useEffect(() => {
    const all = getSessionLog();
    const v = getSession();
    setViewer(v);
    const scoped = v?.role === "sales_manager" ? all.filter((s) => s.managerEmail === v.email) : all;
    setSessions([...scoped].reverse());
  }, []);

  const signOut = useCallback(() => {
    clearSessionCookies();
    router.push(LOGIN_PATH);
    router.refresh();
  }, [router]);

  /** Admin/manager get a direct preview, no lead lookup, unlike the sales
   * staff flow (`/session/start`) this skips past. */
  const openDashboard = useCallback(() => {
    setActiveSession(createWalkInLead());
    router.push(SPACE_PATH);
  }, [router]);

  const list = sessions ?? [];
  const today = list.filter((s) => isToday(s.startedAt));
  const avgMs =
    list.length > 0 ? list.reduce((sum, s) => sum + s.totalTimeMs, 0) / list.length : 0;
  const dayCounts = buildDayCounts(list);
  const topProperties = buildTopProperties(list);
  const staffList = USERS.filter(
    (u) =>
      u.role === "sales_staff" &&
      (viewer?.role === "admin" || (viewer?.role === "sales_manager" && u.managerEmail === viewer.email)),
  );

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
          <div className={`${styles.statIcon} ${styles.statIconBlue}`}>{CalendarIcon}</div>
          <div>
            <div className={styles.statLabel}>Today&apos;s Presentations</div>
            <div className={styles.statValue}>{today.length}</div>
          </div>
        </div>
        <div className={styles.stat}>
          <div className={`${styles.statIcon} ${styles.statIconIndigo}`}>{UsersIcon}</div>
          <div>
            <div className={styles.statLabel}>Total Presentations</div>
            <div className={styles.statValue}>{list.length}</div>
          </div>
        </div>
        <div className={styles.stat}>
          <div className={`${styles.statIcon} ${styles.statIconGold}`}>{ClockIcon}</div>
          <div>
            <div className={styles.statLabel}>Avg. Session Time</div>
            <div className={styles.statValue}>{list.length ? formatDuration(avgMs) : "N/A"}</div>
          </div>
        </div>
      </div>

      {viewer && <ControlsPanel staff={staffList} />}

      {list.length > 0 && (
        <div className={styles.chartRow}>
          <TrendChart data={dayCounts} />
          <TopPropertiesChart data={topProperties} />
        </div>
      )}

      <div className={styles.sectionTitle}>Recent Customers</div>

      {sessions === null ? null : list.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>{EmptyIcon}</div>
          <p>
            No sessions logged yet. They&apos;ll show up here once sales staff
            complete one (End Session on the showcase screen).
          </p>
        </div>
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
              {list.map((s, i) => (
                <tr key={s.id} style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}>
                  <td>
                    <div className={styles.customer}>
                      <span className={styles.avatar}>{initials(s.leadName)}</span>
                      <span>
                        {s.leadName}
                        <br />
                        <span className={styles.leadId}>{s.leadId}</span>
                      </span>
                    </div>
                  </td>
                  <td>{s.staffName}</td>
                  <td>{new Date(s.startedAt).toLocaleString()}</td>
                  <td>{formatDuration(s.totalTimeMs)}</td>
                  <td>
                    <div className={styles.path}>
                      {s.events.length === 0 ? (
                        <span className={styles.noEvents}>
                          VR tour only, no property cards opened
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
