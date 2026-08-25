/**
 * How long the customer actually spent inside each project, accumulated
 * across a whole presentation and sent once, on logout, as Sperto's
 * `project_time` (see finalizeSession in lib/session.ts).
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
 * access is wrapped for the same reason lib/session.ts wraps its own: on a
 * locked-down kiosk profile the whole `sessionStorage` access throws, and
 * these calls sit inside click handlers that must not die half-way.
 *
 * Totals are held in milliseconds and converted to whole seconds once, at
 * read time. Sperto's field is seconds; rounding each visit separately would
 * quietly lose up to half a second per open, which on a project opened a
 * dozen times is a visible undercount.
 */

const KEY = "futeservices_project_time";

type State = {
  /** project name -> accumulated milliseconds. Only ever gains keys. */
  totals: Record<string, number>;
  /** The project on screen right now. `since` is null while paused (tab
   *  hidden), so a resume can tell "paused" from "never started". */
  open: { project: string; since: number | null } | null;
};

function read(): State {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return { totals: {}, open: null };
    const parsed = JSON.parse(raw) as Partial<State>;
    return {
      totals: parsed.totals && typeof parsed.totals === "object" ? parsed.totals : {},
      open: parsed.open ?? null,
    };
  } catch {
    return { totals: {}, open: null };
  }
}

function write(state: State) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Best-effort: the presentation still runs, Sperto just gets no times.
  }
}

/** Bank whatever the running timer has earned so far and leave it running
 *  from `now`. Pure — the caller decides what to do with the result. */
function bank(state: State, now: number): State {
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
export function startProjectTimer(project: string) {
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
export function getProjectTimeSeconds(): Record<string, number> {
  const state = bank(read(), Date.now());
  const out: Record<string, number> = {};
  for (const [project, ms] of Object.entries(state.totals)) {
    const seconds = Math.round(ms / 1000);
    if (seconds > 0) out[project] = seconds;
  }
  return out;
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
