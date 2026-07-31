"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSession, SPACE_PATH } from "@/lib/auth";
import { listActivity, type ActivityEvent, type ActivityType } from "@/lib/activity";
import { signOut } from "@/lib/sign-out";
import { fetchControlState, kickStaff, restoreLogin, setProjectBlockedFor } from "@/lib/controls";
import { createWalkInLead } from "@/lib/leads";
import { setActiveSession } from "@/lib/session";
import { USERS } from "@/lib/users";
import { portfolioGroups } from "@/data/properties";
import { LoadingBlock, Spinner } from "./Spinner";

/** Every project across every portfolio (Alibaug + Fortune City), not just
 * Fortune City's six — the block/active grid should cover everything a
 * staff member could actually show a customer. */
const ALL_PROJECTS = portfolioGroups.flatMap((g) => g.projects);
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

/** "Chrome · Windows" instead of the raw `navigator.userAgent` string —
 * that full string is logged (and still available via CSV export) but is
 * too long/noisy to show inline next to a name or in a table cell. */
function shortDevice(ua: string | null): string | null {
  if (!ua) return null;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Mac OS X/.test(ua)
      ? "macOS"
      : /Android/.test(ua)
        ? "Android"
        : /iPhone|iPad/.test(ua)
          ? "iOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return os ? `${browser} · ${os}` : browser;
}

const TREND_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 6;

/** Prev/Next + "Page X of Y", shared by the Customer Visits and Login
 * History tables so a long history doesn't render as one giant scroll. */
function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className={styles.pagination}>
      <button
        type="button"
        className={styles.pageBtn}
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
      >
        &#8249; Prev
      </button>
      <span className={styles.pageStatus}>
        Page {page} of {totalPages}
      </span>
      <button
        type="button"
        className={styles.pageBtn}
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
      >
        Next &#8250;
      </button>
    </div>
  );
}

const TYPE_LABEL: Record<ActivityType, string> = {
  login: "Login",
  logout: "Logout",
  search: "Search",
  customer_profile: "Profile",
  project_open: "Project",
  property_shown: "Shown",
  tour_view: "360° Tour",
  floor_plan: "Floor Plan",
  gallery: "Gallery",
  brochure_download: "Brochure",
  media_view: "Media",
  amenities: "Amenities",
  filter: "Filter",
  notes: "Note",
  status: "Status",
  step: "Page",
};

/**
 * One completed customer walkthrough: every activity event sharing a login
 * session id *and* a lead id, grouped together (a sales staff member can run
 * more than one presentation per login, so grouping by session id alone
 * would merge unrelated customers). Built client-side from the flat
 * activity log (src/lib/activity.ts) rather than stored as its own record,
 * since the log is the single source of truth admins/managers can't have
 * edited out from under them.
 */
type Presentation = {
  key: string;
  sessionId: string;
  leadId: string;
  leadName: string;
  staffName: string;
  staffEmail: string;
  managerEmail: string | null;
  startedAt: number;
  endedAt: number;
  totalTimeMs: number;
  timeline: ActivityEvent[];
  shown: ActivityEvent[];
  /** Distinct project names opened, for the summary column. */
  projects: string[];
  /** Whether the 360° tour was opened at any point. */
  tourShown: boolean;
  device: string | null;
  location: string | null;
};

/** What actually counts as "shown" to the customer, for the compact
 * per-presentation chip row — excludes housekeeping events (search, profile
 * lookup, notes) that belong in the full timeline but would just be noise
 * here. */
const SHOWN_TYPES = new Set<ActivityType>([
  "project_open",
  "property_shown",
  "tour_view",
  "floor_plan",
  "gallery",
  "brochure_download",
  "media_view",
  "amenities",
]);

function groupPresentations(events: ActivityEvent[]): Presentation[] {
  const groups = new Map<string, ActivityEvent[]>();
  for (const e of events) {
    if (!e.leadId) continue;
    const key = `${e.sessionId}::${e.leadId}`;
    const arr = groups.get(key);
    if (arr) arr.push(e);
    else groups.set(key, [e]);
  }
  return [...groups.values()]
    .map((evs) => {
      const sorted = [...evs].sort((a, b) => a.at - b.at);
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const shown = sorted.filter((e) => SHOWN_TYPES.has(e.type));
      return {
        key: `${first.sessionId}::${first.leadId}`,
        sessionId: first.sessionId,
        leadId: first.leadId as string,
        leadName: first.leadName ?? (first.leadId as string),
        staffName: first.staffName,
        staffEmail: first.staffEmail,
        managerEmail: first.managerEmail,
        startedAt: first.at,
        endedAt: last.at,
        totalTimeMs: last.at - first.at,
        timeline: sorted,
        shown,
        projects: [
          ...new Set(
            shown
              .filter((e) => e.type === "project_open")
              .map((e) => e.label.replace(/^(Opened|Visited) /, "")),
          ),
        ],
        tourShown: shown.some((e) => e.type === "tour_view"),
        device: sorted.find((e) => e.device)?.device ?? null,
        location: sorted.find((e) => e.location)?.location ?? null,
      };
    })
    .sort((a, b) => b.startedAt - a.startedAt);
}

/** Login/logout spans, independent of any one customer, so "Login/Logout
 * time" (the goal's own wording) is answerable even for a login that never
 * opened a customer profile. */
type LoginSpan = {
  sessionId: string;
  staffName: string;
  staffEmail: string;
  managerEmail: string | null;
  loginAt: number | null;
  logoutAt: number | null;
  device: string | null;
  location: string | null;
};

function groupLogins(events: ActivityEvent[]): LoginSpan[] {
  const groups = new Map<string, ActivityEvent[]>();
  for (const e of events) {
    if (e.type !== "login" && e.type !== "logout") continue;
    const arr = groups.get(e.sessionId);
    if (arr) arr.push(e);
    else groups.set(e.sessionId, [e]);
  }
  return [...groups.entries()]
    .map(([sessionId, evs]) => {
      const sorted = [...evs].sort((a, b) => a.at - b.at);
      const login = sorted.find((e) => e.type === "login");
      const logout = [...sorted].reverse().find((e) => e.type === "logout");
      const any = login ?? sorted[0];
      return {
        sessionId,
        staffName: any.staffName,
        staffEmail: any.staffEmail,
        managerEmail: any.managerEmail,
        loginAt: login?.at ?? null,
        logoutAt: logout?.at ?? null,
        device: any.device,
        location: any.location,
      };
    })
    .sort((a, b) => (b.loginAt ?? 0) - (a.loginAt ?? 0));
}

/** Midnight-aligned count of presentations started on each of the last
 * TREND_DAYS days (oldest first), for the trend chart below. */
function buildDayCounts(list: Presentation[]) {
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

/** Top projects opened across every presentation's "what was shown" log,
 * most-shown first. */
function buildTopProperties(list: Presentation[], max = 6) {
  const counts = new Map<string, number>();
  for (const s of list) {
    for (const e of s.shown) {
      const label = e.label.replace(/^(Opened|Visited) /, "");
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, max);
}

/** Per-staff performance summary: how many walkthroughs each ran, how many
 * distinct customers they reached, and their average session length —
 * the "performance analysis" the reporting goal asks for, ranked so the
 * busiest staff member reads first. */
function buildStaffLeaderboard(list: Presentation[]) {
  const byStaff = new Map<
    string,
    { staffName: string; sessions: number; totalMs: number; customers: Set<string>; shown: number }
  >();
  for (const p of list) {
    const row =
      byStaff.get(p.staffEmail) ??
      { staffName: p.staffName, sessions: 0, totalMs: 0, customers: new Set<string>(), shown: 0 };
    row.sessions += 1;
    row.totalMs += p.totalTimeMs;
    row.customers.add(p.leadId);
    row.shown += p.shown.length;
    byStaff.set(p.staffEmail, row);
  }
  return [...byStaff.entries()]
    .map(([email, r]) => ({
      email,
      staffName: r.staffName,
      sessions: r.sessions,
      customers: r.customers.size,
      shown: r.shown,
      avgMs: r.sessions > 0 ? r.totalMs / r.sessions : 0,
    }))
    .sort((a, b) => b.sessions - a.sessions);
}

/** How often each kind of content actually got shown to customers — answers
 * "what are they leaning on: tours, floor plans, brochures?" Capped at the
 * top 6, same as buildTopProperties, so this card has a fixed height
 * regardless of how many content types are actually in use. */
function buildContentBreakdown(list: Presentation[], max = 6) {
  const counts = new Map<ActivityType, number>();
  for (const p of list) {
    for (const e of p.shown) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([type, count]) => ({ label: TYPE_LABEL[type], count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, max);
}

/** Which hours of the day presentations start in, so a manager can see when
 * the floor is actually busy. Only hours with activity are returned. */
function buildHourHistogram(list: Presentation[]) {
  const buckets = new Array<number>(24).fill(0);
  for (const p of list) buckets[new Date(p.startedAt).getHours()] += 1;
  const firstActive = buckets.findIndex((c) => c > 0);
  const lastActive = buckets.reduce((last, c, i) => (c > 0 ? i : last), -1);
  if (firstActive === -1) return [];
  // Pad to at least a 6-hour window so a single busy hour isn't one lonely bar.
  const from = Math.max(0, Math.min(firstActive, lastActive - 5));
  const to = Math.min(23, Math.max(lastActive, from + 5));
  return buckets.slice(from, to + 1).map((count, i) => {
    const hour = from + i;
    const h12 = hour % 12 === 0 ? 12 : hour % 12;
    return { label: `${h12} ${hour < 12 ? "AM" : "PM"}`, count };
  });
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
      <div className={styles.chartTitle}>Most-Shown Projects</div>
      {data.length === 0 ? (
        <p className={styles.chartEmpty}>No projects opened yet.</p>
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

/** Staff performance table: sessions run, customers reached, content shown
 * and average session length, busiest first. A table rather than a chart —
 * these are four unrelated numbers per person, not one series to compare. */
function StaffLeaderboard({
  rows,
}: {
  rows: { email: string; staffName: string; sessions: number; customers: number; shown: number; avgMs: number }[];
}) {
  return (
    <div className={styles.chartCard}>
      <div className={styles.chartTitle}>Staff Performance</div>
      {rows.length === 0 ? (
        <p className={styles.chartEmpty}>No sessions to compare yet.</p>
      ) : (
        <table className={styles.miniTable}>
          <thead>
            <tr>
              <th>Sales Staff</th>
              <th>Sessions</th>
              <th>Customers</th>
              <th>Shown</th>
              <th>Avg. Time</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.email}>
                <td>
                  <div className={styles.customer}>
                    <span className={styles.avatar}>{initials(r.staffName)}</span>
                    <span>{r.staffName}</span>
                  </div>
                </td>
                <td className={styles.numCell}>{r.sessions}</td>
                <td className={styles.numCell}>{r.customers}</td>
                <td className={styles.numCell}>{r.shown}</td>
                <td className={styles.numCell}>{formatDuration(r.avgMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** What kinds of content get shown — same ranked-bar form as
 * TopPropertiesChart, since it answers the same "which is used most"
 * question, just about content type instead of project. */
function ContentBreakdownChart({ data }: { data: { label: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));

  return (
    <div className={styles.chartCard}>
      <div className={styles.chartTitle}>What Gets Shown</div>
      {data.length === 0 ? (
        <p className={styles.chartEmpty}>Nothing shown to customers yet.</p>
      ) : (
        <div className={styles.propBars}>
          {data.map((d) => (
            <div key={d.label} className={styles.propRow} tabIndex={0}>
              <span className={styles.propLabel}>{d.label}</span>
              <div className={styles.propTrack}>
                <div className={styles.propBar} style={{ width: `${(d.count / max) * 100}%` }} />
              </div>
              <span className={styles.propValue}>{d.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Presentation starts by hour of day — a column chart, same as the daily
 * trend, because it's also a distribution across ordered time buckets. */
function BusyHoursChart({ data }: { data: { label: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const peakIndex = data.reduce((best, d, i) => (d.count > (data[best]?.count ?? 0) ? i : best), 0);

  return (
    <div className={styles.chartCard}>
      <div className={styles.chartTitle}>Busiest Hours</div>
      {data.length === 0 ? (
        <p className={styles.chartEmpty}>No sessions to plot yet.</p>
      ) : (
        <div className={styles.trendChart}>
          {data.map((d, i) => (
            <div key={d.label} className={styles.trendCol} tabIndex={0}>
              {i === peakIndex && d.count > 0 && (
                <span className={styles.trendPeakLabel}>{d.count}</span>
              )}
              <div className={styles.trendTrack}>
                <div className={styles.trendBar} style={{ height: `${(d.count / max) * 100}%` }} />
              </div>
              <span className={styles.trendTooltip}>
                {d.count} started at {d.label}
              </span>
              <span className={styles.trendAxisLabel}>{d.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Drop-in replacement for a native `<select>`: the OS renders a native
 * dropdown's option list itself (that's the stray white/blue popup a
 * `<select>` shows even with heavy CSS on it — Windows/Chrome largely
 * ignore option styling), so matching this app's dark glass theme means not
 * using `<select>` at all here. Closes on outside click or Escape. */
function StyledDropdown({
  value,
  placeholder,
  options,
  onChange,
}: {
  value: string;
  placeholder: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selectedLabel = options.find((o) => o.value === value)?.label ?? placeholder;

  const rows = [{ value: "", label: placeholder }, ...options];

  return (
    <div className={styles.dropdownWrap} ref={ref}>
      <button
        type="button"
        className={`${styles.filterInput} ${styles.filterSelect} ${open ? styles.filterSelectOpen : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={styles.selectValue}>{selectedLabel}</span>
        <svg
          className={styles.selectCaret}
          width="10"
          height="7"
          viewBox="0 0 10 7"
          fill="none"
          aria-hidden="true"
        >
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" />
        </svg>
      </button>
      {open && (
        <ul className={styles.dropdownMenu} role="listbox">
          {rows.map((o) => {
            const selected = value === o.value;
            return (
              <li
                key={o.value || "__all"}
                className={`${styles.dropdownItem} ${selected ? styles.dropdownItemActive : ""}`}
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
              >
                <span className={styles.dropdownMarker} aria-hidden="true" />
                {o.label}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** One entry per dashboard section — exactly one navbar button each, so no
 * two buttons ever open the same thing. */
const VIEW_TABS = [
  { key: "customers" as const, label: "Customer Visits" },
  { key: "staff" as const, label: "Staff Activity" },
  { key: "analytics" as const, label: "Reports" },
  { key: "logins" as const, label: "Login History" },
];

/** Selected reporting window. Both ends are midnight-aligned timestamps;
 * `to` is the *start* of the end day, and callers add a day to make the
 * range inclusive. Empty object means "all time". */
type DateRange = { from?: number; to?: number };

const RANGE_PRESETS = [
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7 Days" },
  { key: "30d", label: "Last 30 Days" },
] as const;

function midnight(d = new Date()): number {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c.getTime();
}

/** Aligning to midnight (rather than "now minus N×24h") is what makes
 * "Today" mean the calendar day, which is how a manager reads it. */
function presetRange(key: string): DateRange {
  const today = midnight();
  if (key === "today") return { from: today, to: today };
  if (key === "7d") return { from: today - 6 * DAY_MS, to: today };
  if (key === "30d") return { from: today - 29 * DAY_MS, to: today };
  return {};
}

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_FMT: Intl.DateTimeFormatOptions = { month: "long", year: "numeric" };
const SHORT_DATE: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };

function rangeLabel(range: DateRange): string {
  if (range.from === undefined) return "All Time";
  const today = midnight();
  if (range.from === today && range.to === today) return "Today";
  const from = new Date(range.from).toLocaleDateString(undefined, SHORT_DATE);
  if (range.to === undefined || range.to === range.from) return from;
  return `${from} - ${new Date(range.to).toLocaleDateString(undefined, SHORT_DATE)}`;
}

/**
 * Themed date-range calendar. Hand-rolled rather than `<input type="date">`
 * because a native date input's popup is browser chrome that CSS can't
 * reach, so it can never match this UI. Days after today are disabled:
 * activity only ever exists in the past.
 */
function DateRangePicker({
  range,
  onChange,
}: {
  range: DateRange;
  onChange: (range: DateRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => {
    const d = new Date(range.from ?? Date.now());
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const today = midnight();
  const firstWeekday = month.getDay();
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  // Leading blanks so the 1st lands under its real weekday column.
  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const dayTs = (day: number) => new Date(month.getFullYear(), month.getMonth(), day).getTime();

  /** First click sets the start and clears the end; second click sets the
   * end, flipping the pair if the user picked backwards. */
  const pickDay = (day: number) => {
    const ts = dayTs(day);
    if (range.from === undefined || range.to !== undefined) {
      onChange({ from: ts });
      return;
    }
    onChange(ts < range.from ? { from: ts, to: range.from } : { from: range.from, to: ts });
    setOpen(false);
  };

  const shiftMonth = (delta: number) =>
    setMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));

  // Don't let the user page into months that can't hold any activity.
  const nextDisabled = month.getFullYear() * 12 + month.getMonth() >= new Date().getFullYear() * 12 + new Date().getMonth();

  return (
    <div className={styles.dropdownWrap} ref={ref}>
      <button
        type="button"
        className={`${styles.filterInput} ${styles.filterSelect} ${open ? styles.filterSelectOpen : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className={styles.selectValue}>{rangeLabel(range)}</span>
        <svg className={styles.selectCaret} width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
          <path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      </button>

      {open && (
        <div className={styles.calendarPanel} role="dialog" aria-label="Choose date range">
          <div className={styles.calPresets}>
            <button
              type="button"
              className={`${styles.calPreset} ${range.from === undefined ? styles.calPresetActive : ""}`}
              onClick={() => {
                onChange({});
                setOpen(false);
              }}
            >
              All Time
            </button>
            {RANGE_PRESETS.map((p) => {
              const r = presetRange(p.key);
              const active = range.from === r.from && range.to === r.to;
              return (
                <button
                  key={p.key}
                  type="button"
                  className={`${styles.calPreset} ${active ? styles.calPresetActive : ""}`}
                  onClick={() => {
                    onChange(r);
                    setOpen(false);
                  }}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          <div className={styles.calHead}>
            <button
              type="button"
              className={styles.calNav}
              onClick={() => shiftMonth(-1)}
              aria-label="Previous month"
            >
              &#8249;
            </button>
            <span className={styles.calMonth}>
              {month.toLocaleDateString(undefined, MONTH_FMT)}
            </span>
            <button
              type="button"
              className={styles.calNav}
              onClick={() => shiftMonth(1)}
              disabled={nextDisabled}
              aria-label="Next month"
            >
              &#8250;
            </button>
          </div>

          <div className={styles.calGrid}>
            {DAY_LABELS.map((d, i) => (
              <span key={i} className={styles.calWeekday}>
                {d}
              </span>
            ))}
            {cells.map((day, i) => {
              if (day === null) return <span key={`b${i}`} />;
              const ts = dayTs(day);
              const future = ts > today;
              const isStart = range.from === ts;
              const isEnd = range.to === ts;
              const inRange =
                range.from !== undefined &&
                range.to !== undefined &&
                ts > range.from &&
                ts < range.to;
              return (
                <button
                  key={day}
                  type="button"
                  disabled={future}
                  onClick={() => pickDay(day)}
                  className={`${styles.calDay} ${inRange ? styles.calDayInRange : ""} ${
                    isStart || isEnd ? styles.calDayEdge : ""
                  } ${ts === today ? styles.calDayToday : ""}`}
                >
                  {day}
                </button>
              );
            })}
          </div>

          <div className={styles.calFoot}>
            {range.from !== undefined && range.to === undefined
              ? "Pick the end date"
              : rangeLabel(range)}
          </div>
        </div>
      )}
    </div>
  );
}

/** Live wall clock for the header. Ticks every second, and renders nothing
 * until mounted so the server-rendered HTML can't disagree with the
 * client's first paint (a hydration mismatch). */
function LiveClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (!now) return <span className={styles.clock} aria-hidden="true" />;

  return (
    <span className={styles.clock}>
      <span className={styles.clockTime}>
        {now.toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
        })}
      </span>
      <span className={styles.clockDate}>
        {now.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
      </span>
    </span>
  );
}

/** Full chronological walkthrough for one presentation *or* one staff
 * member's whole day (questionnaire: "understand exactly what the Sales
 * Staff showed the customer"). Generic over its `timeline` so both the
 * per-customer table below and StaffProfilePanel's full-day view can reuse
 * the same list UI. */
function TimelinePanel({
  panelKey,
  title,
  meta,
  timeline,
  onClose,
  /** Set when this sits inside another panel: drops the card chrome so
   * there's no border-inside-a-border, and reclaims that padding for the
   * event list. */
  flat = false,
}: {
  panelKey: string;
  title: string;
  meta: string;
  timeline: ActivityEvent[];
  onClose: () => void;
  flat?: boolean;
}) {
  const [cursor, setCursor] = useState(0);
  const anchorAt = timeline[0]?.at ?? 0;

  useEffect(() => {
    setCursor(0);
  }, [panelKey]);

  return (
    <div className={`${styles.timelinePanel} ${flat ? styles.timelinePanelFlat : ""}`}>
      <div className={styles.timelineHeader}>
        <div>
          <div className={styles.chartTitle}>{title}</div>
          <div className={styles.timelineMeta}>{meta}</div>
        </div>
        <div className={styles.timelineActions}>
          <span className={styles.timelineStep}>
            {timeline.length ? cursor + 1 : 0} / {timeline.length}
          </span>
          <button type="button" className={styles.timelineClose} onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>
      </div>
      <ol className={styles.timelineList}>
        {timeline.map((e, i) => (
          <li
            key={e.id}
            className={`${styles.timelineItem} ${i === cursor ? styles.timelineItemActive : ""}`}
            onClick={() => setCursor(i)}
          >
            <span className={styles.timelineBadge}>{TYPE_LABEL[e.type]}</span>
            <span className={styles.timelineLabel}>
              {e.label}
              {e.leadName ? ` · ${e.leadName}` : ""}
            </span>
            {e.durationMs !== null && (
              <span className={styles.timelineDuration}>{formatDuration(e.durationMs)}</span>
            )}
            <span className={styles.timelineTime}>
              {new Date(e.at).toLocaleTimeString()} &middot; {relativeTime(e.at, anchorAt)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const STATUS_IDLE_MS = 5 * 60 * 1000;

type StaffStatus = "Online" | "In Meeting" | "Busy" | "Offline";

/** Live status, inferred from the most recent activity event rather than a
 * heartbeat: logged out → Offline; nothing in the last 5 minutes → Offline
 * (covers a tab closed without hitting Log out); most recent event is an
 * explicit "Busy" toggle (PropertyShowcase's header button — the only
 * honest source for that state, since nothing else in the app implies it)
 * → Busy, until the next login/logout/Available toggle supersedes it;
 * still attached to a customer → In Meeting; otherwise Online. */
function deriveStatus(events: ActivityEvent[], now: number): StaffStatus {
  if (events.length === 0) return "Offline";
  const last = events[events.length - 1];
  if (last.type === "logout") return "Offline";
  if (now - last.at > STATUS_IDLE_MS) return "Offline";
  if (last.type === "status") return last.label === "Marked Busy" ? "Busy" : "Online";
  return last.leadId ? "In Meeting" : "Online";
}

/** Node types that are just internal bookkeeping (the app currently has one
 * generic presentation "step") rather than something a customer was shown —
 * left out of the roadmap diagram so it reads as content, not noise. */
const ROADMAP_EXCLUDE = new Set<ActivityType>(["step"]);

/**
 * Visual "boxes connected by arrows" roadmap of one client's (or one
 * login-session's General Activity) walkthrough — the sequence-diagram view
 * requested alongside the existing list-style `TimelinePanel`. Time spent
 * per node is derived, not separately tracked: it's the gap until the next
 * thing happened, which is exactly "how long did they spend on that project"
 * for a project_open node, using only timestamps the activity log already
 * records.
 */
function RoadmapDiagram({ timeline }: { timeline: ActivityEvent[] }) {
  const nodes = timeline.filter((e) => !ROADMAP_EXCLUDE.has(e.type));

  if (nodes.length === 0) {
    return <p className={styles.chartEmpty}>No activity yet for this client.</p>;
  }

  return (
    <div className={styles.roadmap}>
      <div className={styles.roadmapTrack}>
        {nodes.map((e, i) => {
          const next = nodes[i + 1];
          const dwellMs = next ? next.at - e.at : null;
          return (
            <div className={styles.roadmapStep} key={e.id}>
              <div className={styles.roadmapNode}>
                <span className={styles.roadmapBadge}>{TYPE_LABEL[e.type]}</span>
                <span className={styles.roadmapLabel} title={e.label}>
                  {e.label}
                </span>
                <span className={styles.roadmapTime}>{new Date(e.at).toLocaleTimeString()}</span>
                <span className={styles.roadmapDuration}>
                  {dwellMs !== null ? formatDuration(dwellMs) : "Ongoing"}
                </span>
              </div>
              {next && <span className={styles.roadmapConnector}>&#8594;</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The "select a Sales Staff" panel: live status, project permissions
 * (Active/Blocked per project), force-logout, a chip per customer they've
 * presented to (plus a "General Activity" chip for login/search/etc. not
 * tied to any one customer), and — for whichever chip is active — a visual
 * roadmap of that walkthrough with a toggle to the list/replay view. Built
 * from every event for that one staffEmail, not just the grouped-by-lead
 * presentations the main table shows, so a login that never reached a
 * customer still shows up (as General Activity).
 */
function StaffControlPanel({
  staffEmail,
  staffName,
  events,
  eventsLoading,
  onClose,
}: {
  staffEmail: string;
  staffName: string;
  events: ActivityEvent[];
  /** True until this staff member's activity has actually come back, so the
   * walkthrough list can say "loading" instead of "nothing recorded yet" —
   * which is a very different, and wrong, thing to tell a manager. */
  eventsLoading: boolean;
  onClose: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(id);
  }, []);

  const [kicked, setKicked] = useState(false);
  const [blocked, setBlocked] = useState<string[]>([]);
  const [loginSuspended, setLoginSuspended] = useState(false);
  /** The block/active grid is only meaningful once the server has said which
   * projects are actually blocked — until then every project would read
   * "Active", which is a claim, not a placeholder. */
  const [controlsLoading, setControlsLoading] = useState(true);
  useEffect(() => {
    setKicked(false);
    setControlsLoading(true);
    let cancelled = false;
    fetchControlState(staffEmail).then((state) => {
      if (cancelled) return;
      setBlocked(state.blockedProjects);
      setLoginSuspended(state.loginSuspended);
      setControlsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [staffEmail]);

  /** Which control is mid-request. Each of these is a real round trip to
   * /api/controls, and each one is disruptive enough (signing someone out,
   * pulling a project off their screen) that "did that land?" needs an
   * answer on the button itself. */
  const [kickPending, setKickPending] = useState(false);
  const [restorePending, setRestorePending] = useState(false);
  const [pendingSlugs, setPendingSlugs] = useState<string[]>([]);

  // Force-logout and restore both wait for the server before they claim
  // anything: each is a one-shot, consequential action, and "Signal Sent" or
  // a lifted suspension shown before the request landed is a claim the panel
  // can't back up. The spinner covers the gap.
  const forceLogout = async () => {
    setKickPending(true);
    const ok = await kickStaff(staffEmail);
    setKickPending(false);
    if (ok) {
      setKicked(true);
      setLoginSuspended(true);
    }
  };

  const restoreAccess = async () => {
    setRestorePending(true);
    const ok = await restoreLogin(staffEmail);
    setRestorePending(false);
    if (ok) setLoginSuspended(false);
  };

  // The block toggles are the exception: they're flipped back and forth
  // freely, so they still update optimistically (with a pending marker on
  // the button being synced) and roll back if the server refuses.

  const toggleBlocked = async (slug: string) => {
    const next = !blocked.includes(slug);
    setBlocked((prev) => (next ? [...prev, slug] : prev.filter((s) => s !== slug)));
    setPendingSlugs((prev) => [...prev, slug]);
    const ok = await setProjectBlockedFor(staffEmail, slug, next);
    setPendingSlugs((prev) => prev.filter((s) => s !== slug));
    if (!ok) {
      setBlocked((prev) => (next ? prev.filter((s) => s !== slug) : [...prev, slug]));
    }
  };

  // A themed confirm step for anything disruptive (force logout, blocking a
  // project) instead of the browser's own unstyleable window.confirm().
  const [pendingConfirm, setPendingConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const requestConfirm = (message: string, onConfirm: () => void) => setPendingConfirm({ message, onConfirm });

  const sorted = useMemo(() => [...events].sort((a, b) => a.at - b.at), [events]);
  const status = deriveStatus(sorted, now);
  const last = sorted[sorted.length - 1] ?? null;
  const device = shortDevice([...sorted].reverse().find((e) => e.device)?.device ?? null);
  const location = [...sorted].reverse().find((e) => e.location)?.location ?? null;

  const clientPresentations = useMemo(() => groupPresentations(events), [events]);
  const generalTimeline = useMemo(
    () => sorted.filter((e) => !e.leadId),
    [sorted],
  );
  const chips = useMemo(() => {
    const fromClients = clientPresentations.map((p) => ({
      key: p.key,
      label: p.leadName,
      meta: `${new Date(p.startedAt).toLocaleDateString()} · ${formatDuration(p.totalTimeMs)}`,
      timeline: p.timeline,
    }));
    if (generalTimeline.length === 0) return fromClients;
    return [
      ...fromClients,
      {
        key: "GENERAL",
        label: "General Activity",
        meta: `${generalTimeline.length} events`,
        timeline: generalTimeline,
      },
    ];
  }, [clientPresentations, generalTimeline]);

  const [activeKey, setActiveKey] = useState<string | null>(null);
  useEffect(() => {
    // Reset to the most recent client (or General Activity if there isn't
    // one yet) whenever a *different* staff member is selected — but not on
    // every poll refresh, so switching chips mid-view doesn't get undone.
    setActiveKey(chips[0]?.key ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffEmail]);
  const activeChip = chips.find((c) => c.key === activeKey) ?? chips[0] ?? null;

  const [chipsPage, setChipsPage] = useState(1);
  useEffect(() => {
    setChipsPage(1);
  }, [staffEmail]);
  const chipsTotalPages = Math.max(1, Math.ceil(chips.length / PAGE_SIZE));
  const pagedChips = chips.slice((chipsPage - 1) * PAGE_SIZE, chipsPage * PAGE_SIZE);

  const [viewMode, setViewMode] = useState<"roadmap" | "list">("roadmap");

  const blockedCount = blocked.length;

  return (
    <div className={styles.staffPanel}>
      <div className={styles.staffPanelHead}>
        <div className={styles.staffIdentity}>
          <span className={styles.staffAvatar}>{initials(staffName)}</span>
          <div>
            <div className={styles.staffPanelName}>{staffName}</div>
            <div className={styles.metaRow}>
              <span>{staffEmail}</span>
              <span>Last active {last ? new Date(last.at).toLocaleString() : "never"}</span>
              {device && <span>{device}</span>}
              {location && <span>{location}</span>}
            </div>
          </div>
        </div>
        <div className={styles.timelineActions}>
          <span className={`${styles.statusPill} ${styles[`status${status.replace(" ", "")}`]}`}>
            &#9679; {status}
          </span>
          <button
            type="button"
            className={styles.kickBtn}
            disabled={kickPending}
            aria-busy={kickPending}
            onClick={() =>
              requestConfirm(
                `Force logout ${staffName}? They'll be signed out immediately, mid-session if active.`,
                forceLogout,
              )
            }
          >
            {kickPending ? (
              <>
                <Spinner size={11} />
                Sending…
              </>
            ) : kicked ? (
              "Signal Sent"
            ) : (
              "Force Logout"
            )}
          </button>
          {loginSuspended && (
            <>
              <span className={styles.suspendedPill}>&#9679; Login Suspended</span>
              <button
                type="button"
                className={styles.restoreBtn}
                onClick={restoreAccess}
                disabled={restorePending}
                aria-busy={restorePending}
              >
                {restorePending ? (
                  <>
                    <Spinner size={11} />
                    Restoring…
                  </>
                ) : (
                  "Restore Access"
                )}
              </button>
            </>
          )}
          <button type="button" className={styles.timelineClose} onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>
      </div>

      <section className={styles.staffSection}>
        <div className={styles.staffSectionHead}>
          <span className={styles.snapshotLabel}>Projects This Staff Can Show</span>
          <span className={styles.staffSectionMeta}>
            {controlsLoading ? (
              <span className={styles.inlineLoading}>
                <Spinner size={11} />
                Loading permissions…
              </span>
            ) : (
              <>
                {ALL_PROJECTS.length - blockedCount} active &middot; {blockedCount} blocked
              </>
            )}
          </span>
        </div>
        <div className={styles.permissionsGrid}>
          {ALL_PROJECTS.map((p) => {
            const isBlocked = blocked.includes(p.slug);
            const isPending = pendingSlugs.includes(p.slug);
            return (
              <div key={p.slug} className={styles.permCard}>
                <span className={styles.permCardName}>{p.name}</span>
                <button
                  type="button"
                  className={`${styles.blockBtn} ${isBlocked ? styles.blockBtnBlocked : ""}`}
                  disabled={controlsLoading || isPending}
                  aria-busy={isPending}
                  onClick={() => {
                    // Only confirm when blocking — reverting a block back to
                    // active is the safe direction and doesn't need a gate.
                    if (isBlocked) {
                      toggleBlocked(p.slug);
                    } else {
                      requestConfirm(`Block ${p.name} for ${staffName}? They won't be able to open it.`, () =>
                        toggleBlocked(p.slug),
                      );
                    }
                  }}
                >
                  {controlsLoading ? (
                    <Spinner size={11} />
                  ) : isPending ? (
                    <>
                      <Spinner size={11} />
                      {isBlocked ? "Blocking…" : "Unblocking…"}
                    </>
                  ) : isBlocked ? (
                    "Blocked"
                  ) : (
                    "Active"
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {eventsLoading && chips.length === 0 ? (
        <LoadingBlock message="Loading activity…" />
      ) : chips.length === 0 ? (
        <p className={styles.chartEmpty}>No activity recorded for this staff member yet.</p>
      ) : (
        <section className={styles.staffSection}>
          <div className={styles.staffSectionHead}>
            <span className={styles.snapshotLabel}>Client Walkthroughs</span>
            <button
              type="button"
              className={styles.replayBtn}
              onClick={() => setViewMode((m) => (m === "roadmap" ? "list" : "roadmap"))}
            >
              {viewMode === "roadmap" ? "Timeline List" : "Journey Map"}
            </button>
          </div>

          <div className={styles.clientCards}>
            {pagedChips.map((c) => (
              <button
                key={c.key}
                type="button"
                className={`${styles.clientCard} ${c.key === activeChip?.key ? styles.clientCardActive : ""}`}
                onClick={() => setActiveKey(c.key)}
              >
                <span className={styles.clientCardAvatar}>{initials(c.label)}</span>
                <span className={styles.clientCardBody}>
                  <span className={styles.clientCardName}>{c.label}</span>
                  <span className={styles.clientCardMeta}>{c.meta}</span>
                </span>
              </button>
            ))}
          </div>
          <Pagination page={chipsPage} totalPages={chipsTotalPages} onChange={setChipsPage} />

          {activeChip &&
            (viewMode === "roadmap" ? (
              <RoadmapDiagram timeline={activeChip.timeline} />
            ) : (
              <TimelinePanel
                flat
                panelKey={`${staffEmail}::${activeChip.key}`}
                title={activeChip.label}
                meta={activeChip.meta}
                timeline={activeChip.timeline}
                onClose={() => setViewMode("roadmap")}
              />
            ))}
        </section>
      )}

      {pendingConfirm && (
        <div className={styles.confirmOverlay} onClick={() => setPendingConfirm(null)}>
          <div className={styles.confirmCard} onClick={(e) => e.stopPropagation()}>
            <p className={styles.confirmMessage}>{pendingConfirm.message}</p>
            <div className={styles.confirmActions}>
              <button type="button" className={styles.confirmCancel} onClick={() => setPendingConfirm(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={styles.confirmOk}
                onClick={() => {
                  pendingConfirm.onConfirm();
                  setPendingConfirm(null);
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The reporting view shared by both `/admin/dashboard` and
 * `/manager/dashboard`: a projects overview, Today's Presentations, total
 * session duration, filters (staff/customer/project/date), and every
 * presentation's full timeline with a replay control, read from the
 * server-side activity log (src/lib/activity.ts / /api/activity — append-only,
 * so sales staff have no path to edit or delete it). A sales manager only
 * sees their own team's activity (scoped server-side by managerEmail); an
 * admin always sees everyone.
 */
export function SessionReports({
  brandLabel,
  title,
}: {
  brandLabel: string;
  title: string;
}) {
  const router = useRouter();
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  /** True whenever an activity request is in flight, including refetches
   * triggered by a changed filter — a table that already has last query's
   * rows in it otherwise looks like the new filter simply did nothing. */
  const [refreshing, setRefreshing] = useState(true);
  const [viewer, setViewer] = useState<ReturnType<typeof getSession>>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  /** Set while one of the two dock actions that leave this dashboard is
   * navigating (sign-out also writes its logout event first). */
  const [leaving, setLeaving] = useState<"showcase" | "logout" | null>(null);

  const [staffFilter, setStaffFilter] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [range, setRange] = useState<DateRange>({});
  /** Staff Activity's own search box — narrows the staff picker by name,
   * separate from staffFilter (which is the selected value, not a query).
   * Typing opens the results live, rather than needing a separate dropdown
   * click after typing. */
  const [staffSearch, setStaffSearch] = useState("");
  const [staffSearchOpen, setStaffSearchOpen] = useState(false);
  const staffSearchRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!staffSearchOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (staffSearchRef.current && !staffSearchRef.current.contains(e.target as Node)) {
        setStaffSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [staffSearchOpen]);

  const [customersPage, setCustomersPage] = useState(1);
  const [loginsPage, setLoginsPage] = useState(1);
  // A changed filter can shrink the list out from under whatever page the
  // user was on, so start back at page 1 rather than land on a blank page.
  useEffect(() => {
    setCustomersPage(1);
    setLoginsPage(1);
  }, [staffFilter, customerFilter, range]);

  const [profile, setProfile] = useState<{ email: string; name: string } | null>(null);
  const [profileEvents, setProfileEvents] = useState<ActivityEvent[] | null>(null);
  /** Which single section the content area shows. One navbar button per
   * section (and only one button per section), so nothing is duplicated and
   * the whole thing stays on one screen without stacking every panel. */
  const [view, setView] = useState<"staff" | "analytics" | "customers" | "logins">("customers");

  useEffect(() => {
    setViewer(getSession());
  }, []);

  const reload = useCallback(() => {
    const v = getSession();
    if (!v) return;
    setRefreshing(true);
    listActivity({
      managerEmail: v.role === "sales_manager" ? v.email : undefined,
      staffEmail: staffFilter || undefined,
      project: customerFilter || undefined,
      from: range.from,
      // `to` is the start of the end day, so add a day (minus 1ms) to make
      // the range inclusive of everything that happened on it.
      to: range.to === undefined ? undefined : range.to + DAY_MS - 1,
    }).then((evts) => {
      setEvents(evts);
      setRefreshing(false);
    });
  }, [staffFilter, customerFilter, range]);

  useEffect(() => {
    reload();
  }, [reload]);

  // The open staff profile polls independently of the filtered table above
  // (its own request, scoped to just that one staffEmail plus the viewer's
  // own manager scoping) so "live status" stays current without re-running
  // the filtered query.
  useEffect(() => {
    if (!profile) {
      setProfileEvents(null);
      return;
    }
    let cancelled = false;
    const v = getSession();
    const load = () => {
      if (document.hidden) return Promise.resolve();
      return listActivity({
        staffEmail: profile.email,
        managerEmail: v?.role === "sales_manager" ? v.email : undefined,
      }).then((evts) => {
        if (!cancelled) setProfileEvents(evts);
      });
    };
    load();
    const id = window.setInterval(load, 20000);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [profile]);

  const leave = useCallback(() => {
    setLeaving("logout");
    void signOut();
  }, []);

  /** Admin/manager get a direct preview, no lead lookup, unlike the sales
   * staff flow (`/session/start`) this skips past. */
  const openDashboard = useCallback(() => {
    setLeaving("showcase");
    setActiveSession(createWalkInLead());
    router.push(SPACE_PATH);
  }, [router]);

  const presentations = useMemo(() => groupPresentations(events ?? []), [events]);
  const logins = useMemo(() => groupLogins(events ?? []), [events]);
  const openPresentation = presentations.find((p) => p.key === openKey) ?? null;

  const customerTotalPages = Math.max(1, Math.ceil(presentations.length / PAGE_SIZE));
  const pagedPresentations = presentations.slice(
    (customersPage - 1) * PAGE_SIZE,
    customersPage * PAGE_SIZE,
  );
  const loginTotalPages = Math.max(1, Math.ceil(logins.length / PAGE_SIZE));
  const pagedLogins = logins.slice((loginsPage - 1) * PAGE_SIZE, loginsPage * PAGE_SIZE);

  const today = presentations.filter((s) => isToday(s.startedAt));
  const avgMs =
    presentations.length > 0
      ? presentations.reduce((sum, s) => sum + s.totalTimeMs, 0) / presentations.length
      : 0;
  const dayCounts = buildDayCounts(presentations);
  const topProperties = buildTopProperties(presentations);
  const staffLeaderboard = buildStaffLeaderboard(presentations);
  const contentBreakdown = buildContentBreakdown(presentations);
  const busyHours = buildHourHistogram(presentations);
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
        <LiveClock />
      </header>

      <div className={styles.eyebrow}>Reporting</div>
      <h1 className={styles.title}>{title}</h1>

      {/* Full filter bar only where it actually drives a table/chart
          (Customer Visits, Reports). Staff Activity keeps just the staff
          picker — that dropdown is how you select who to view, customer
          and date filters don't apply there. Login History has neither:
          nothing in that table is filterable by customer or project. */}
      {(view === "customers" || view === "analytics") && (
        <>
          <div className={styles.sectionTitle}>Search &amp; Filter</div>
          <div className={styles.filterBar}>
            <StyledDropdown
              value={staffFilter}
              placeholder="All Sales Staff"
              options={staffList.map((s) => ({ value: s.email, label: s.name }))}
              onChange={(email) => {
                setStaffFilter(email);
                const staff = staffList.find((s) => s.email === email);
                setProfile(staff ? { email: staff.email, name: staff.name } : null);
                // Picking a staff member is a request to look at that staff
                // member, so jump straight to their section.
                if (staff) setView("staff");
              }}
            />
            <input
              type="text"
              className={styles.filterInput}
              placeholder="Customer or project…"
              value={customerFilter}
              onChange={(e) => setCustomerFilter(e.target.value)}
            />
            <DateRangePicker range={range} onChange={setRange} />
          </div>
        </>
      )}

      {view === "staff" && (
        <>
          <div className={styles.sectionTitle}>Select Sales Staff</div>
          <div className={styles.filterBar}>
            <div className={styles.dropdownWrap} ref={staffSearchRef}>
              <input
                type="text"
                className={styles.filterInput}
                placeholder="Search staff by name…"
                value={staffSearch}
                onChange={(e) => {
                  setStaffSearch(e.target.value);
                  setStaffSearchOpen(true);
                }}
                onFocus={() => setStaffSearchOpen(true)}
              />
              {staffSearchOpen && (
                <ul className={styles.dropdownMenu} role="listbox">
                  {(() => {
                    const matches = staffList.filter((s) =>
                      s.name.toLowerCase().includes(staffSearch.trim().toLowerCase()),
                    );
                    if (matches.length === 0) {
                      return <li className={styles.dropdownEmpty}>No staff found</li>;
                    }
                    return matches.map((s) => (
                      <li
                        key={s.email}
                        className={`${styles.dropdownItem} ${staffFilter === s.email ? styles.dropdownItemActive : ""}`}
                        role="option"
                        aria-selected={staffFilter === s.email}
                        onClick={() => {
                          setStaffFilter(s.email);
                          setProfile({ email: s.email, name: s.name });
                          setStaffSearch(s.name);
                          setStaffSearchOpen(false);
                        }}
                      >
                        <span className={styles.dropdownMarker} aria-hidden="true" />
                        {s.name}
                      </li>
                    ));
                  })()}
                </ul>
              )}
            </div>
          </div>
        </>
      )}

      {/* Just the date range — logins have no customer/project to search by,
          but "which staff logged in on which day" is still a real question. */}
      {view === "logins" && (
        <>
          <div className={styles.sectionTitle}>Filter by Date</div>
          <div className={styles.filterBar}>
            <DateRangePicker range={range} onChange={setRange} />
          </div>
        </>
      )}

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
            <div className={styles.statValue}>{presentations.length}</div>
          </div>
        </div>
        <div className={styles.stat}>
          <div className={`${styles.statIcon} ${styles.statIconGold}`}>{ClockIcon}</div>
          <div>
            <div className={styles.statLabel}>Avg. Session Time</div>
            <div className={styles.statValue}>{presentations.length ? formatDuration(avgMs) : "N/A"}</div>
          </div>
        </div>
      </div>

      {/* A refetch keeps the previous results on screen (they're still the
          best answer available), so the only signal that a new filter is
          being applied is this marker. */}
      {refreshing && events !== null && (
        <div className={styles.refreshing} role="status">
          <Spinner size={11} />
          Updating…
        </div>
      )}

      {/* One section at a time, chosen from the fixed navbar below. */}
      <div className={styles.viewArea}>
        {/* Nothing has come back from /api/activity yet: every section below
            reads off `events`, and each of their empty states would claim
            "nothing logged" while the request is still in flight. */}
        {events === null && <LoadingBlock message="Loading activity…" size={22} />}

        {events !== null && view === "staff" &&
          (profile ? (
            <StaffControlPanel
              staffEmail={profile.email}
              staffName={profile.name}
              events={profileEvents ?? []}
              eventsLoading={profileEvents === null}
              onClose={() => {
                setProfile(null);
                setStaffFilter("");
              }}
            />
          ) : (
            <div className={styles.empty}>
              <div className={styles.emptyIcon}>{EmptyIcon}</div>
              <p>Pick a sales staff member from the filter above to see their activity and permissions.</p>
            </div>
          ))}

        {events !== null && view === "analytics" &&
          (presentations.length > 0 ? (
            <div className={styles.reportGrid}>
              <div className={styles.reportWide}>
                <TrendChart data={dayCounts} />
              </div>
              <TopPropertiesChart data={topProperties} />
              <ContentBreakdownChart data={contentBreakdown} />
              <BusyHoursChart data={busyHours} />
              <div className={styles.reportWide}>
                <StaffLeaderboard rows={staffLeaderboard} />
              </div>
            </div>
          ) : (
            <div className={styles.empty}>
              <div className={styles.emptyIcon}>{EmptyIcon}</div>
              <p>No presentations logged yet, so there&apos;s nothing to chart.</p>
            </div>
          ))}

        {events !== null && view === "customers" &&
          (presentations.length === 0 ? (
            <div className={styles.empty}>
              <div className={styles.emptyIcon}>{EmptyIcon}</div>
              <p>
                No sessions logged yet. They&apos;ll show up here live as sales
                staff walk a customer through the showcase.
              </p>
            </div>
          ) : (
            <div className={styles.customersLayout}>
              <div className={styles.tableColumn}>
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
                      {pagedPresentations.map((s, i) => (
                        <tr
                          key={s.key}
                          className={`${styles.clickableRow} ${s.key === openKey ? styles.clickableRowActive : ""}`}
                          style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}
                          onClick={() => setOpenKey(s.key === openKey ? null : s.key)}
                        >
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
                            {/* A summary, not the full event list: the
                                per-event detail is one click away in the
                                panel beside this table, and listing every
                                chip here made the row unreadable. */}
                            <div className={styles.shownCell}>
                              {s.shown.length === 0 ? (
                                <span className={styles.noEvents}>Nothing opened</span>
                              ) : (
                                <>
                                  <div className={styles.path}>
                                    {s.tourShown && (
                                      <span className={styles.pathStep}>360&deg; Tour</span>
                                    )}
                                    {s.projects.map((p) => (
                                      <span key={p} className={styles.pathStep}>
                                        {p}
                                      </span>
                                    ))}
                                    {s.projects.length === 0 && !s.tourShown && (
                                      <span className={styles.noEvents}>No projects opened</span>
                                    )}
                                  </div>
                                  <span className={styles.shownCount}>
                                    {s.shown.length} action{s.shown.length === 1 ? "" : "s"} &middot; tap
                                    row to view
                                  </span>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <Pagination page={customersPage} totalPages={customerTotalPages} onChange={setCustomersPage} />
              </div>

              {/* Pinned beside the table rather than appearing below it —
                  otherwise picking a row on a long list meant scrolling
                  well past the fold to find what you just opened. */}
              <div className={styles.walkthroughRail}>
                {openPresentation ? (
                  <TimelinePanel
                    panelKey={openPresentation.key}
                    title={`${openPresentation.leadName} with ${openPresentation.staffName}`}
                    meta={[
                      new Date(openPresentation.startedAt).toLocaleString(),
                      formatDuration(openPresentation.totalTimeMs),
                      shortDevice(openPresentation.device),
                      openPresentation.location,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    timeline={openPresentation.timeline}
                    onClose={() => setOpenKey(null)}
                  />
                ) : (
                  <div className={styles.railEmpty}>
                    <div className={styles.emptyIcon}>{EmptyIcon}</div>
                    <p>Tap a customer to see their full walkthrough here.</p>
                  </div>
                )}
              </div>
            </div>
          ))}

        {events !== null && view === "logins" &&
          (logins.length === 0 ? (
            <div className={styles.empty}>
              <div className={styles.emptyIcon}>{EmptyIcon}</div>
              <p>No logins recorded yet.</p>
            </div>
          ) : (
            <>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Sales Staff</th>
                      <th>Login</th>
                      <th>Logout</th>
                      <th>Device</th>
                      <th>Location</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedLogins.map((l) => (
                      <tr key={l.sessionId}>
                        <td>{l.staffName}</td>
                        <td>{l.loginAt ? new Date(l.loginAt).toLocaleString() : "-"}</td>
                        <td>{l.logoutAt ? new Date(l.logoutAt).toLocaleString() : "Still active"}</td>
                        <td className={styles.deviceCell}>{shortDevice(l.device) ?? "-"}</td>
                        <td>{l.location ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={loginsPage} totalPages={loginTotalPages} onChange={setLoginsPage} />
            </>
          ))}
      </div>

      <nav className={styles.sideDock} aria-label="Dashboard sections and actions">
        {VIEW_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`${styles.dockBtn} ${view === t.key ? styles.dockBtnActive : ""}`}
            aria-pressed={view === t.key}
            onClick={() => setView(t.key)}
          >
            {t.label}
          </button>
        ))}
        <button
          type="button"
          className={styles.dockBtn}
          onClick={openDashboard}
          disabled={leaving !== null}
          aria-busy={leaving === "showcase"}
        >
          {leaving === "showcase" ? (
            <>
              <Spinner size={12} />
              Opening…
            </>
          ) : (
            <>Open Showcase&nbsp;&#8599;</>
          )}
        </button>
        <span className={styles.dockDivider} />
        <button
          type="button"
          className={`${styles.dockBtn} ${styles.dockBtnDanger}`}
          onClick={leave}
          disabled={leaving !== null}
          aria-busy={leaving === "logout"}
        >
          {leaving === "logout" ? (
            <>
              <Spinner size={12} />
              Signing out…
            </>
          ) : (
            "Log out"
          )}
        </button>
      </nav>
    </div>
  );
}
