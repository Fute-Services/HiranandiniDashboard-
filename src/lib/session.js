import { actorFields, track } from "./activity";
import { getSession, getSessionId } from "./auth";
import { fetchWithTimeout } from "./http";
import { clearProjectTime, getProjectTimeSeconds, getProjectVisits } from "./project-time";

/**
 * The active presentation session: which lead a sales staff member is
 * currently walking through the app with, plus which steps they've visited
 * and how long each took (questionnaire §6's "complete journey", meaning
 * pages visited, navigation path, time spent). Held in `sessionStorage`
 * (survives navigation between steps, cleared when the tab closes) rather
 * than a cookie, since it's read/written entirely client-side and never needs
 * to gate a route the way the auth cookies do.
 *
 * A session carries: the `lead`, `startedAt`, a `path` of `{ step, enteredAt,
 * timeSpentMs }` entries, an `events` list of `{ label, type, at }` (a
 * specific thing shown/clicked and when, relative to session start), the
 * `currentStep` and `currentStepEnteredAt`, and the `deviceType`.
 */
const ACTIVE_SESSION_KEY = "futeservices_active_session";

/** Re-exported so client code keeps importing it from here, where it has
 * always been. It lives in its own dependency-free module because the
 * device-usage route validates request bodies against the same list, and this
 * one is browser-only (sessionStorage, window). */
export { DEVICE_TYPES } from "./device-types";

/**
 * sessionStorage doesn't just return null when it's unavailable — it throws,
 * on the whole access, whenever storage is blocked or full (a locked-down
 * kiosk profile, private browsing, a quota that's filled up). Every read and
 * write here goes through these two so that never escapes: the callers are
 * click handlers like "Start Session" that navigate immediately afterwards,
 * and a throw there kills the handler mid-way, leaving the button locked in
 * its "Starting session…" state with no navigation and no way back but a
 * reload. The session log is a nice-to-have; the flow working is not.
 */
function readRaw() {
  try {
    return sessionStorage.getItem(ACTIVE_SESSION_KEY);
  } catch {
    return null;
  }
}

function writeRaw(value) {
  try {
    sessionStorage.setItem(ACTIVE_SESSION_KEY, value);
  } catch {
    // Best-effort; the presentation still runs, it just isn't resumable.
  }
}

/** Fire-and-forget call to Sperto's device-usage log
 * (server/lib/sperto-device-usage.js) via the server-side route that holds
 * the api_key. Never throws and is never awaited by callers — a presentation
 * session starting or ending must never depend on this succeeding, same
 * reasoning as `track()` in lib/activity.js. `keepalive` lets the "OUT" call
 * survive the page unload that immediately follows logout. */
function recordDeviceUsage(lead, deviceType, type, projectTime, visits) {
  try {
    fetchWithTimeout("/api/session/device-usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        leadId: lead.leadId,
        deviceType,
        type,
        // On "OUT" this carries the presentation's per-project seconds — one
        // object per project, `[{ "Elena": 180 }, { "Alibaug": 240 }]` (see
        // getProjectVisits). On "IN", and on an "OUT" where the customer was
        // never actually taken into a project, there is no time to report and
        // the field keeps its original meaning: the page in front of them.
        //
        // An empty array is deliberately not sent. It would read as a visit
        // with no projects in it, which is a claim; the page URL is not.
        pageUrl: visits && visits.length > 0 ? visits : window.location.href,
        ...(projectTime && Object.keys(projectTime).length > 0 ? { projectTime } : {}),
      }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // best-effort; ignore
  }
}

/**
 * Set the moment an "OUT" is fired, so a second one can't be.
 *
 * Logging out reaches finalizeSession more than once on the ordinary path —
 * the showcase's Log out calls it directly, to close the timeline out while
 * the session is still readable, and signOut() then calls it again so every
 * other exit (idle timeout, force-logout, the dashboards) reports the
 * session closed too. Both calls used to be harmless repeats. An "OUT"
 * carrying project_time is not harmless twice: Sperto would see the same
 * visit closed two or three times over, with the times counted each time.
 *
 * A sessionStorage flag rather than a module-level boolean, because signOut
 * leaves by hard navigation (see lib/sign-out.js) and that tears the module
 * down mid-flight. The storage entry survives it, and dies with the tab
 * along with everything else about the presentation.
 */
const OUT_SENT_KEY = "futeservices_device_usage_out_sent";

/** True if this call is the one that gets to send the "OUT". */
function claimOutSend() {
  try {
    if (sessionStorage.getItem(OUT_SENT_KEY)) return false;
    sessionStorage.setItem(OUT_SENT_KEY, "1");
  } catch {
    // Storage unavailable (locked-down kiosk profile, same case readRaw
    // guards against): better a possible duplicate OUT than a presentation
    // that never reports itself closed at all.
  }
  return true;
}

function clearOutSent() {
  try {
    sessionStorage.removeItem(OUT_SENT_KEY);
  } catch {
    // Best-effort, same as the write above.
  }
}

export function setActiveSession(lead, deviceType = null) {
  const session = {
    lead,
    startedAt: Date.now(),
    path: [],
    events: [],
    currentStep: null,
    currentStepEnteredAt: null,
    deviceType,
  };
  writeRaw(JSON.stringify(session));
  // A new presentation starts from zero on both counts: the previous
  // customer's project times must never be attributed to this one, and this
  // session needs its own "OUT" still available to send.
  clearProjectTime();
  clearOutSent();
  recordDeviceUsage(lead, deviceType, "IN");
}

export function getActiveSession() {
  const raw = readRaw();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveActiveSession(session) {
  writeRaw(JSON.stringify(session));
}

/** Streams one activity-log event tied to the lead/staff of the current
 * active session (see src/lib/activity.js). No-ops if either is missing. */
function trackForSession(session, type, label, durationMs) {
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
    device: session.deviceType ?? undefined,
    ...actorFields(staff.email, staff.name),
  });
}

/**
 * Closes out the time spent on whatever step was previously active, then
 * opens `step`. Called once when the showcase screen mounts (there's only
 * one screen in V1, so this just marks "presentation started" for timing).
 */
export function recordStepEnter(step) {
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
 *
 * `durationMs` is for events that close out something that was open for a
 * while — a project the staff member showed and then shut. The roadmap can
 * only ever *infer* dwell from the gap to the next event, which is wrong the
 * moment a session ends on that project; a measured duration isn't.
 */
export function logSessionEvent(label, type = "project_open", durationMs = null) {
  const session = getActiveSession();
  if (!session) return;
  session.events.push({ label, type, at: Date.now() });
  saveActiveSession(session);
  trackForSession(session, type, label, durationMs);
}

export function clearActiveSession() {
  try {
    sessionStorage.removeItem(ACTIVE_SESSION_KEY);
  } catch {
    // Same reason as readRaw/writeRaw above: sign-out must not throw here.
  }
}

/**
 * Closes out the current step's time locally and clears the active session.
 * Called from the showcase's Log out, which is the only way a presentation
 * ends now. The activity log itself has already been written live by every
 * recordStepEnter/logSessionEvent call along the way (see trackForSession
 * above), so there's nothing left to persist here.
 */
export function finalizeSession() {
  const session = getActiveSession();
  if (!session) return;
  if (session.currentStep && session.currentStepEnteredAt) {
    const now = Date.now();
    trackForSession(session, "step", `Left "${session.currentStep}"`, now - session.currentStepEnteredAt);
  }
  // The one place per-project time reaches Sperto — accumulated all session
  // (lib/project-time.js) and sent only here, once. Both readers bank the
  // still-running timer first, so whatever project was on screen when Log out
  // was pressed is counted rather than dropped.
  //
  // Two fields carrying the same visits on purpose: `project_time` is a
  // custom field their published API doesn't list, so there is no guarantee
  // their backend stores it; `page_url` is theirs. Whichever one they are
  // actually reading has the numbers in it.
  if (claimOutSend()) {
    recordDeviceUsage(
      session.lead,
      session.deviceType,
      "OUT",
      getProjectTimeSeconds(),
      getProjectVisits(),
    );
  }
  clearProjectTime();
  clearActiveSession();
}
