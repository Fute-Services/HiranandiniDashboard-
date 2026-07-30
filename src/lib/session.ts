import { actorFields, track, type ActivityType } from "./activity";
import { getSession, getSessionId } from "./auth";
import type { Lead } from "./leads";

export type StepEvent = {
  step: string;
  enteredAt: number;
  timeSpentMs: number;
};

/** A specific thing shown/clicked during the session, e.g. which property
 * card was opened, and when (relative to session start). */
export type SessionEvent = {
  label: string;
  type: ActivityType;
  at: number;
};

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

/** Streams one activity-log event tied to the lead/staff of the current
 * active session (see src/lib/activity.ts). No-ops if either is missing. */
function trackForSession(session: ActiveSession, type: ActivityType, label: string, durationMs: number | null) {
  const staff = getSession();
  const sessionId = getSessionId();
  if (!staff || !sessionId) return;
  track({
    sessionId,
    type,
    label,
    leadId: session.lead.leadId,
    leadName: session.lead.name,
    durationMs,
    ...actorFields(staff.email, staff.name),
  });
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
    const timeSpentMs = now - session.currentStepEnteredAt;
    session.path.push({
      step: session.currentStep,
      enteredAt: session.currentStepEnteredAt,
      timeSpentMs,
    });
    trackForSession(session, "step", `Left "${session.currentStep}"`, timeSpentMs);
  }
  session.currentStep = step;
  session.currentStepEnteredAt = now;
  saveActiveSession(session);
  trackForSession(session, "step", `Entered "${step}"`, null);
}

/**
 * Logs a specific "what was shown" moment, e.g. a property card opened for
 * the customer, with a timestamp, so the dashboard can answer "what did
 * they show, and how far into the session" (not just total time). Safe to
 * call even if nothing's active (no-ops). Streams live to the server-side
 * activity log in addition to the local buffer this session's summary reads.
 */
export function logSessionEvent(label: string, type: ActivityType = "project_open") {
  const session = getActiveSession();
  if (!session) return;
  session.events.push({ label, type, at: Date.now() });
  saveActiveSession(session);
  trackForSession(session, type, label, null);
}

export function clearActiveSession() {
  sessionStorage.removeItem(ACTIVE_SESSION_KEY);
}

/**
 * "End Session" closes out the current step's time locally and clears the
 * active session. The activity log itself has already been written live by
 * every recordStepEnter/logSessionEvent call along the way (see
 * trackForSession above), so there's nothing left to persist here.
 */
export function finalizeSession() {
  const session = getActiveSession();
  if (!session) return;
  if (session.currentStep && session.currentStepEnteredAt) {
    const now = Date.now();
    trackForSession(session, "step", `Left "${session.currentStep}"`, now - session.currentStepEnteredAt);
  }
  clearActiveSession();
}
