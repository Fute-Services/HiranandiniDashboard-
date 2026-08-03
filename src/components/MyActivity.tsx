"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getSession, SESSION_START_PATH } from "@/lib/auth";
import { listActivity, type ActivityEvent } from "@/lib/activity";
import { formatDuration, groupPresentations, initials, TYPE_LABEL, type Presentation } from "./SessionReports";
import { LoadingBlock } from "./Spinner";
import styles from "./MyActivity.module.css";

/**
 * A sales staff member's own activity, read-only — the same data an admin
 * or manager sees about them, but self-serve, so the tracking that powers
 * coaching/reporting doesn't feel like a one-way mirror only management can
 * see through (questionnaire's trust/morale concern). Framed around what
 * they've done (sessions run, customers reached), not a list of mistakes.
 */
export function MyActivity() {
  const router = useRouter();
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  // getSession() reads document.cookie — client-only, so it can't run during
  // the server-rendered/prerendered pass this "use client" page still gets.
  const [staff, setStaff] = useState<ReturnType<typeof getSession>>(null);

  useEffect(() => {
    const s = getSession();
    setStaff(s);
    if (!s) return;
    let cancelled = false;
    listActivity({ staffEmail: s.email }).then((rows) => {
      if (!cancelled) setEvents(rows);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const presentations = useMemo<Presentation[]>(
    () => (events ? groupPresentations(events) : []),
    [events],
  );

  const totalMs = presentations.reduce((sum, p) => sum + p.totalTimeMs, 0);
  const customers = new Set(presentations.map((p) => p.leadId)).size;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>My Activity</div>
          <h1 className={styles.title}>{staff?.name ?? "Your activity"}</h1>
        </div>
        <button type="button" className={styles.back} onClick={() => router.push(SESSION_START_PATH)}>
          Back to Start
        </button>
      </header>

      {events === null ? (
        <LoadingBlock message="Loading your activity…" />
      ) : (
        <>
          <div className={styles.statRow}>
            <div className={styles.stat}>
              <div className={styles.statValue}>{presentations.length}</div>
              <div className={styles.statLabel}>Presentations Run</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statValue}>{customers}</div>
              <div className={styles.statLabel}>Customers Reached</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statValue}>{presentations.length ? formatDuration(totalMs / presentations.length) : "N/A"}</div>
              <div className={styles.statLabel}>Avg. Session Time</div>
            </div>
          </div>

          {presentations.length === 0 ? (
            <p className={styles.empty}>No presentations logged yet — they&apos;ll show up here as you run them.</p>
          ) : (
            <ul className={styles.list}>
              {presentations.map((p) => (
                <li key={p.key} className={styles.item}>
                  <div className={styles.itemHead}>
                    <span className={styles.avatar}>{initials(p.leadName)}</span>
                    <div>
                      <div className={styles.itemName}>{p.leadName}</div>
                      <div className={styles.itemMeta}>
                        {new Date(p.startedAt).toLocaleString()} &middot; {formatDuration(p.totalTimeMs)}
                      </div>
                    </div>
                  </div>
                  <div className={styles.chips}>
                    {p.shown.length === 0 ? (
                      <span className={styles.noEvents}>Nothing opened</span>
                    ) : (
                      p.shown.map((e) => (
                        <span key={e.id} className={styles.chip}>
                          {TYPE_LABEL[e.type]}
                        </span>
                      ))
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
