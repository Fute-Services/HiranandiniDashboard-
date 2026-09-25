import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DASHBOARD_PATH, getSession, getSessionId } from "@/lib/auth";
import { actorFields, track } from "@/lib/activity";
import { claimLead, createWalkInLead, findLead } from "@/lib/leads";
import { DEVICE_TYPES, setActiveSession } from "@/lib/session";
import { signOut } from "@/lib/sign-out";
import { useNavigationLock } from "@/lib/useNavigationLock";
import { Spinner } from "./Spinner";
import styles from "./SessionStart.module.css";

/**
 * The one screen between the login and the presentation: find the customer,
 * pick the device, go.
 *
 * The staff member types the Lead ID (or the customer's phone number), taps a
 * device, and they're in the showcase. Two taps from Lead ID to presentation.
 * A miss — a typo, an ID that isn't on file yet — is recoverable inline rather
 * than by signing in again.
 *
 * Nothing about the matched customer is drawn on this screen. There used to be
 * a full profile card (budget, tower, family size, loan), and after that just
 * the name, the lead status pill and a "visited N times before — high intent"
 * note on the device step. This screen is held facing the customer, so all of
 * it read back to them as a file the shop keeps on them; the lead status in
 * particular is an internal sales judgement, not something to show its subject.
 * Every one of those details is already in the CRM they came from, so the
 * device step now shows only the question it is asking. The lookup itself is
 * unchanged: the match still drives the lead claim, the activity log and the
 * session, it is just never rendered.
 */
export function SessionStart() {
  const navigate = useNavigate();
  const [match, setMatch] = useState(null);
  const [looking, setLooking] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  /** Set once the customer is confirmed and the device question is up. */
  const [pickingDevice, setPickingDevice] = useState(false);
  /** Which navigation is under way — "start", "walkin" or "logout". Starting
   * a presentation and signing out both leave this screen, and that route
   * change isn't instant — without a marker the button just sits there
   * looking unclicked. The lock releases itself if that navigation never
   * lands, so a dropped request can't leave this card's buttons permanently
   * dead (see lib/useNavigationLock). */
  const [leaving, setLeaving] = useNavigationLock();

  const logActivity = useCallback((type, label, lead) => {
    const staff = getSession();
    const sessionId = getSessionId();
    if (!staff || !sessionId) return;
    track({
      sessionId,
      type,
      label,
      leadId: lead?.leadId ?? null,
      leadName: lead?.name ?? null,
      durationMs: null,
      ...actorFields(staff.email, staff.name),
    });
  }, []);

  const lookUp = useCallback(
    async (customerId) => {
      setLooking(true);
      const result = await findLead(customerId);
      logActivity("search", `Looked up "${customerId.trim()}"`, result.ok ? result.lead : null);
      if (result.ok) {
        setMatch(result.lead);
        setError("");
        // Straight to the device question — the profile card that used to
        // sit here is gone (see this component's note above).
        setPickingDevice(true);
        logActivity("customer_profile", `Opened profile for ${result.lead.name}`, result.lead);
      } else {
        setMatch(null);
        // Whatever the server actually said — "isn't registered in Sperto" is
        // a different instruction to the staff member than "check the ID",
        // and collapsing the two sends them off to re-type something that was
        // never going to work.
        setError(result.error);
      }
      setLooking(false);
    },
    [logActivity],
  );

  function onRetry(e) {
    e.preventDefault();
    if (looking) return;
    void lookUp(query);
  }

  // Claiming the lead stays fire-and-forget (see lib/leads.js) — a dropped
  // claim shouldn't block a presentation with a customer already waiting.
  function confirmDevice(lead, deviceType) {
    if (leaving) return;
    const staff = getSession();
    if (staff) void claimLead(lead.leadId, staff.email, staff.name);
    setLeaving("start");
    setActiveSession(lead, deviceType);
    navigate(DASHBOARD_PATH);
  }

  /** No usable Customer ID — a walk-in the CRM hasn't seen yet. Creates a
   * throwaway lead so the rest of the flow, which always expects one, has
   * something to attach the session to. */
  async function beginWalkIn() {
    if (leaving) return;
    setLeaving("walkin");
    const lead = await createWalkInLead();
    // Release the lock once the walk-in lead exists — the device picker that
    // comes next has its own buttons to click, not this one.
    setLeaving(null);
    setMatch(lead);
    setError("");
    setPickingDevice(true);
  }

  function leave() {
    if (leaving) return;
    setLeaving("logout");
    void signOut();
  }

  return (
    <div className={styles.page}>
      <button
        type="button"
        className={styles.logout}
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
      <div className={styles.card}>
        {looking ? (
          <div className={styles.loading}>
            <Spinner size={20} />
            <p className={styles.lede}>Looking up the customer…</p>
          </div>
        ) : pickingDevice && match ? (
          <div className={styles.result}>
            <div className={styles.eyebrow}>Session Starting</div>
            <h2 className={styles.resultTitle}>Pick your device</h2>
            <p className={styles.lede}>
              Which device are you presenting on? This is what shows up in reports as
              &quot;what device sells the most&quot; — pick the one you&apos;re actually
              holding.
            </p>
            <div className={styles.deviceGrid}>
              {DEVICE_TYPES.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={styles.deviceOption}
                  onClick={() => confirmDevice(match, d)}
                  disabled={leaving !== null}
                >
                  {d}
                </button>
              ))}
            </div>
            <button
              type="button"
              className={styles.back}
              onClick={() => {
                setPickingDevice(false);
                setMatch(null);
                setError("");
              }}
              disabled={leaving !== null}
            >
              Go back
            </button>
          </div>
        ) : (
          <>
            <div className={styles.eyebrow}>Search Customer</div>
            <h1 className={styles.title}>Which customer is this?</h1>
            <p className={styles.lede}>
              Enter the Lead ID or phone number to start the session.
            </p>

            <form onSubmit={onRetry}>
              <label className={styles.field}>
                <span className={styles.label}>Lead ID or Phone Number</span>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    if (error) setError("");
                  }}
                  placeholder="Lead ID or phone number"
                  autoComplete="off"
                  required
                  className={styles.input}
                />
              </label>

              {error && (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              )}

              <button type="submit" className={styles.submit} disabled={leaving !== null}>
                Find Customer&nbsp;&#8599;
              </button>
            </form>

            <button
              type="button"
              className={styles.walkin}
              onClick={beginWalkIn}
              disabled={leaving !== null}
              aria-busy={leaving === "walkin"}
            >
              {leaving === "walkin" ? (
                <>
                  <Spinner size={12} />
                  Starting session…
                </>
              ) : (
                "Continue without a Lead ID"
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
