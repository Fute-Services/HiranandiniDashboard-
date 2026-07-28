/**
 * Finalized session log: what the admin and sales-manager dashboards read
 * (questionnaire §6). Backed by `localStorage` rather than a real API:
 * there's no backend yet, but unlike an in-memory JS variable, this at least
 * survives a page reload and is shared across tabs in the same browser,
 * which is enough to demo "sales staff finish a session → managers/admin see
 * it" without a server. Swap `logCompletedSession`/`getSessionLog` for real
 * API calls once Sperto/CRM access lands, since callers only depend on this shape.
 */
export type StepEvent = {
  step: string;
  enteredAt: number;
  timeSpentMs: number;
};

/** A specific thing shown/clicked during the session, e.g. which property
 * card was opened, and when (relative to session start). */
export type SessionEvent = {
  label: string;
  at: number;
};

export type SessionSummary = {
  id: string;
  leadId: string;
  leadName: string;
  /** Which sales staff member ran this presentation. */
  staffName: string;
  /** That staff member's manager (src/lib/users.ts `managerEmail`), which is what a
   * sales manager's dashboard filters on to see only their own team. */
  managerEmail: string | null;
  startedAt: number;
  endedAt: number;
  totalTimeMs: number;
  rating: number;
  notes: string;
  path: StepEvent[];
  events: SessionEvent[];
};

const LOG_KEY = "hiranandani_session_log";

export function logCompletedSession(summary: SessionSummary) {
  const all = getSessionLog();
  all.push(summary);
  localStorage.setItem(LOG_KEY, JSON.stringify(all));
}

export function getSessionLog(): SessionSummary[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SessionSummary[];
    // Sessions logged before `path`/`events` existed in this shape won't have
    // them; default so older localStorage data doesn't crash newer readers.
    return parsed.map((s) => ({
      ...s,
      path: s.path ?? [],
      events: s.events ?? [],
    }));
  } catch {
    return [];
  }
}
