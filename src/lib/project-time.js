/**
 * How long the customer actually spent inside each project, accumulated
 * across a whole presentation and sent once, on logout, as Sperto's
 * `project_time` (see finalizeSession in lib/session.js).
 *
 * The showcase already logs an open and a close event per project
 * (PropertyShowcase's openViewer/closeViewer), and the activity log keeps
 * each of those as its own line — which is the right shape for a timeline
 * and the wrong shape for Sperto, who want one number per project. Reopening
 * Fortune City three times is three events here and one 300s total there.
 *
 * Rules this module exists to keep:
 *
 * - A project only appears once it has actually been opened. Never a zero
 *   row for something nobody looked at.
 * - Reopening the same project adds to its total; it never creates a second
 *   entry, because the totals are keyed by project name.
 * - Opening B while A is up closes A's timer first, so the two can't both be
 *   running and double-count the same wall-clock second.
 * - A backgrounded tab isn't viewing time. `visibilitychange` pauses the
 *   running timer and resumes it on return, so a session left open over
 *   lunch doesn't report an hour on whatever was last on screen.
 *
 * State lives in `sessionStorage`, same store and same survives-a-refresh /
 * dies-with-the-tab lifetime as the active session it belongs to, and every
 * access is wrapped for the same reason lib/session.js wraps its own: on a
 * locked-down kiosk profile the whole `sessionStorage` access throws, and
 * these calls sit inside click handlers that must not die half-way.
 *
 * Totals are held in milliseconds and converted to whole seconds once, at
 * read time. Sperto's field is seconds; rounding each visit separately would
 * quietly lose up to half a second per open, which on a project opened a
 * dozen times is a visible undercount.
 */

const KEY = "futeservices_project_time";

/**
 * `totals` maps a project name to accumulated milliseconds and only ever
 * gains keys — its insertion order is therefore the order the customer first
 * opened each project, which is the order `getProjectVisits()` reports.
 *
 * `open` is the project on screen right now; its `since` is null while paused
 * (tab hidden), so a resume can tell "paused" from "never started".
 */
function read() {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return { totals: {}, open: null };
    const parsed = JSON.parse(raw);
    return {
      totals: parsed.totals && typeof parsed.totals === "object" ? parsed.totals : {},
      open: parsed.open ?? null,
    };
  } catch {
    return { totals: {}, open: null };
  }
}

function write(state) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Best-effort: the presentation still runs, Sperto just gets no times.
  }
}

/** Bank whatever the running timer has earned so far and leave it running
 *  from `now`. Pure — the caller decides what to do with the result. */
function bank(state, now) {
  const open = state.open;
  if (!open || open.since === null) return state;
  const elapsed = Math.max(0, now - open.since);
  return {
    totals: { ...state.totals, [open.project]: (state.totals[open.project] ?? 0) + elapsed },
    open: { project: open.project, since: now },
  };
}

let hooked = false;

/** Registered lazily on the first open rather than at import, so nothing is
 *  listening on screens that never show a project. Registered once. */
function hookVisibility() {
  if (hooked || typeof document === "undefined") return;
  hooked = true;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pauseProjectTimer();
    else resumeProjectTimer();
  });
}

/**
 * The customer just opened `project`. Closes out whatever was open first —
 * this is the whole of "handle project navigation correctly", and it holds
 * however the previous project was left (× button, Escape, a jump straight
 * from one project to another).
 */
export function startProjectTimer(project) {
  const name = project.trim();
  if (!name) return;
  hookVisibility();
  const now = Date.now();
  const state = bank(read(), now);
  write({ totals: state.totals, open: { project: name, since: now } });
}

/** The project was closed. Safe to call when nothing is open, and safe to
 *  call twice — the second call has no running timer to bank. */
export function stopProjectTimer() {
  const state = bank(read(), Date.now());
  write({ totals: state.totals, open: null });
}

/** Tab hidden / window blurred: bank what's earned and stop the clock, but
 *  remember which project to resume. */
export function pauseProjectTimer() {
  const state = bank(read(), Date.now());
  if (!state.open) return;
  write({ totals: state.totals, open: { project: state.open.project, since: null } });
}

export function resumeProjectTimer() {
  const state = read();
  if (!state.open || state.open.since !== null) return;
  write({ totals: state.totals, open: { project: state.open.project, since: Date.now() } });
}

/**
 * Final per-project seconds for the OUT call. Banks the still-running timer
 * first, so the project on screen at logout is counted rather than dropped.
 * Projects that somehow rounded to zero are left out: Sperto should only see
 * what was genuinely looked at, and "0" reads as a visit that happened.
 */
export function getProjectTimeSeconds() {
  const state = bank(read(), Date.now());
  const out = {};
  for (const [project, ms] of Object.entries(state.totals)) {
    const seconds = Math.round(ms / 1000);
    if (seconds > 0) out[project] = seconds;
  }
  return out;
}

/**
 * The same visits as `getProjectTimeSeconds`, as the array Sperto's
 * `page_url` field carries on the "OUT" call: one object per project, each
 * mapping the project's name to the seconds spent on it, in the order the
 * projects were first opened.
 *
 *   [ { "Elena": 180 }, { "Alibaug": 240 } ]
 *
 * Same content as `project_time`, one object per entry instead of one object
 * for all of them. Why both: `project_time` is a custom field their published
 * API doesn't list, so there is no guarantee their backend stores it;
 * `page_url` is theirs and always has been. Both go out — see
 * `recordDeviceUsage` — so whichever one they are actually reading has the
 * numbers in it.
 *
 * Same "never send a zero" rule as the seconds map: a project that rounds to
 * 0s was a mis-tap, and a `0` in the CRM reads as a visit that happened.
 */
export function getProjectVisits() {
  const state = bank(read(), Date.now());
  const out = [];
  for (const [project, ms] of Object.entries(state.totals)) {
    const time = Math.round(ms / 1000);
    if (time > 0) out.push({ [project]: time });
  }
  return out;
}

/**
 * Which project is on screen right now, and how long this presentation has
 * spent on it in total — banked time plus whatever the running clock has
 * earned since. Reopening a project therefore continues its count rather
 * than restarting it, matching what `getProjectTimeSeconds` will eventually
 * send.
 *
 * Read-only, unlike every other function here: the header ticks this once a
 * second, and banking on each tick would rewrite sessionStorage sixty times
 * a minute for a number nothing has asked to be durable yet. Returns null
 * when no project is open, and holds its total steady while the timer is
 * paused (a backgrounded tab), since `since` is null for exactly that case.
 */
export function readOpenProject() {
  const state = read();
  const open = state.open;
  if (!open) return null;
  const banked = state.totals[open.project] ?? 0;
  const running = open.since === null ? 0 : Math.max(0, Date.now() - open.since);
  return { project: open.project, ms: banked + running };
}

/** Wipe the slate for a new presentation, so one customer's times can never
 *  be attributed to the next. */
export function clearProjectTime() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Same reason as read/write above.
  }
}
