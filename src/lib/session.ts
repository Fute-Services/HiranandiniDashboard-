import type { Lead } from "./leads";
import {
  logCompletedSession,
  type SessionEvent,
  type SessionSummary,
  type StepEvent,
} from "./reports";

/**
 * The active presentation session: which lead a sales staff member is
 * currently walking through the app with, plus which steps they've visited
 * and how long each took (questionnaire §6's "complete journey", meaning
 * pages visited, navigation path, time spent). Held in `sessionStorage` (survives
 * navigation between steps, cleared when the tab closes) rather than a
 * cookie, since it's read/written entirely client-side and never needs to
 * gate a route the way the auth cookies do.
 */
const ACTIVE_SESSION_KEY = "hiranandani_active_session";

export type ActiveSession = {
  lead: Lead;
  startedAt: number;
  path: StepEvent[];
  events: SessionEvent[];
  currentStep: string | null;
  currentStepEnteredAt: number | null;
};

export function setActiveSession(lead: Lead) {
  const session: ActiveSession = {
    lead,
    startedAt: Date.now(),
    path: [],
    events: [],
    currentStep: null,
    currentStepEnteredAt: null,
  };
  sessionStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(session));
}

export function getActiveSession(): ActiveSession | null {
  const raw = sessionStorage.getItem(ACTIVE_SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ActiveSession;
  } catch {
    return null;
  }
}

function saveActiveSession(session: ActiveSession) {
  sessionStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(session));
}

/**
 * Closes out the time spent on whatever step was previously active, then
 * opens `step`. Called once when the showcase screen mounts (there's only
 * one screen in V1, so this just marks "presentation started" for timing).
 */
export function recordStepEnter(step: string) {
  const session = getActiveSession();
  if (!session) return;
  const now = Date.now();
  if (session.currentStep && session.currentStepEnteredAt) {
    session.path.push({
      step: session.currentStep,
      enteredAt: session.currentStepEnteredAt,
      timeSpentMs: now - session.currentStepEnteredAt,
    });
  }
  session.currentStep = step;
  session.currentStepEnteredAt = now;
  saveActiveSession(session);
}

/**
 * Logs a specific "what was shown" moment, e.g. a property card opened for
 * the customer, with a timestamp, so the dashboard can answer "what did
 * they show, and how far into the session" (not just total time). Safe to
 * call even if nothing's active (no-ops).
 */
export function logSessionEvent(label: string) {
  const session = getActiveSession();
  if (!session) return;
  session.events.push({ label, at: Date.now() });
  saveActiveSession(session);
}

export function clearActiveSession() {
  sessionStorage.removeItem(ACTIVE_SESSION_KEY);
}

/**
 * "End Session" closes out the current step's time, builds the final
 * summary (with the feedback rating/notes) and logs it to the report store,
 * then clears the active session. Returns null if there was nothing active.
 */
export function finalizeSession(
  rating: number,
  notes: string,
  staffName: string,
  managerEmail: string | null,
): SessionSummary | null {
  const session = getActiveSession();
  if (!session) return null;

  const now = Date.now();
  const path = [...session.path];
  if (session.currentStep && session.currentStepEnteredAt) {
    path.push({
      step: session.currentStep,
      enteredAt: session.currentStepEnteredAt,
      timeSpentMs: now - session.currentStepEnteredAt,
    });
  }

  const summary: SessionSummary = {
    id: `${session.lead.leadId}-${session.startedAt}`,
    leadId: session.lead.leadId,
    leadName: session.lead.name,
    staffName,
    managerEmail,
    startedAt: session.startedAt,
    endedAt: now,
    totalTimeMs: now - session.startedAt,
    rating,
    notes,
    path,
    events: session.events,
  };

  logCompletedSession(summary);
  clearActiveSession();
  return summary;
}
