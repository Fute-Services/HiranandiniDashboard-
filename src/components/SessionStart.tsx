"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSession, getSessionId, MY_ACTIVITY_PATH, SPACE_PATH } from "@/lib/auth";
import { actorFields, track } from "@/lib/activity";
import { claimLead, createWalkInLead, findLead, findSimilarLeads, type Lead } from "@/lib/leads";
import { setActiveSession, type DeviceType } from "@/lib/session";
import { signOut } from "@/lib/sign-out";
import { useNavigationLock } from "@/lib/useNavigationLock";
import { Spinner } from "./Spinner";
import styles from "./SessionStart.module.css";

/**
 * The "Search Customer" then "Start Session" step, between login and the
 * presentation itself (questionnaire §1's example journey). A sales manager
 * looks a lead up by ID or phone, confirms the match, then starts the
 * session; the Earth-approach (`/space`) is what plays next.
 */
export function SessionStart() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [match, setMatch] = useState<Lead | null>(null);
  /** Leads that look like the same customer under a different phone format
   * or a typo'd name, surfaced only after an exact-match miss — lets staff
   * reuse the existing record instead of the search quietly starting a
   * duplicate lead. */
  const [similar, setSimilar] = useState<Lead[]>([]);
  /** The lookup is now a real network call (see lib/leads.ts), not a sync
   * array scan — gates the submit button so a slow request can't be double-
   * submitted. */
  const [searching, setSearching] = useState(false);
  /** Which navigation is under way. Starting a presentation and signing out
   * both leave this screen, and that route change isn't instant — without a
   * marker the button just sits there looking unclicked. The lock releases
   * itself if that navigation never lands, so a dropped request can't leave
   * this card's three buttons permanently dead (see lib/useNavigationLock). */
  const [leaving, setLeaving] = useNavigationLock<"start" | "walkin" | "logout">();

  function logActivity(type: "search" | "customer_profile" | "lead_merged", label: string, lead: Lead | null) {
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
  }

  async function onSearch(e: React.FormEvent) {
    e.preventDefault();
    if (searching) return;
    setSearching(true);
    const lead = await findLead(query);
    logActivity("search", `Searched "${query.trim()}"`, lead);
    if (!lead) {
      setError(`No customer found for "${query.trim()}". Check the Lead ID or phone number.`);
      setMatch(null);
      setSimilar(await findSimilarLeads(query));
      setSearching(false);
      return;
    }
    setError("");
    setSimilar([]);
    setMatch(lead);
    logActivity("customer_profile", `Opened profile for ${lead.name}`, lead);
    setSearching(false);
  }

  /** Staff confirms a suggested lead is the same customer — reuses that
   * record instead of continuing on to a duplicate walk-in/new entry. */
  function pickSuggestedLead(lead: Lead) {
    setError("");
    setSimilar([]);
    setMatch(lead);
    logActivity("lead_merged", `Matched "${query.trim()}" to existing lead ${lead.name} (${lead.leadId})`, lead);
  }

  function dismissSuggestions() {
    setSimilar([]);
  }

  // Fire-and-forget: claims (or reassigns, logging the audit event
  // server-side) this lead for the staff member starting the session.
  // Best-effort by design (see lib/leads.ts) — a dropped claim shouldn't
  // block the presentation from starting.
  function commitSession(lead: Lead, deviceType: DeviceType) {
    const staff = getSession();
    if (staff) void claimLead(lead.leadId, staff.email, staff.name);
    setActiveSession(lead, deviceType);
    router.push(SPACE_PATH);
  }

  /** "Start Session"/"Continue without a Lead ID" both gate on this first —
   * which device is actually running the presentation isn't something the
   * browser's user-agent can answer ("Chrome · Windows" either way), so it's
   * asked once, here, rather than guessed. */
  const [pendingStart, setPendingStart] = useState<{ lead: Lead; from: "start" | "walkin" } | null>(null);

  function start(lead: Lead, from: "start" | "walkin") {
    if (leaving) return;
    setPendingStart({ lead, from });
  }

  async function beginWalkIn() {
    if (leaving) return;
    setLeaving("walkin");
    const lead = await createWalkInLead();
    // Release the lock once the walk-in lead exists — the device picker
    // that comes next has its own buttons to click, not this one.
    setLeaving(null);
    setPendingStart({ lead, from: "walkin" });
  }

  function confirmDevice(deviceType: DeviceType) {
    if (!pendingStart) return;
    setLeaving(pendingStart.from);
    commitSession(pendingStart.lead, deviceType);
    setPendingStart(null);
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
        className={styles.myActivity}
        onClick={() => router.push(MY_ACTIVITY_PATH)}
      >
        My Activity
      </button>
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
        {pendingStart ? (
          <div className={styles.result}>
            <div className={styles.eyebrow}>One More Thing</div>
            <h2 className={styles.resultName}>Which device are you presenting on?</h2>
            <p className={styles.lede}>
              This is what shows up in reports as &quot;what device sells the most&quot; — pick the
              one you&apos;re actually holding.
            </p>
            <div className={styles.deviceGrid}>
              {(["Tab", "TV", "Kiosk", "Laptop"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  className={styles.deviceOption}
                  onClick={() => confirmDevice(d)}
                >
                  {d}
                </button>
              ))}
            </div>
            <button type="button" className={styles.back} onClick={() => setPendingStart(null)}>
              Cancel
            </button>
          </div>
        ) : !match ? (
          <>
            <div className={styles.eyebrow}>Search Customer</div>
            <h1 className={styles.title}>Start a presentation</h1>
            <p className={styles.lede}>
              Look the customer up by their Lead ID or phone number to begin.
            </p>

            <form onSubmit={onSearch}>
              <label className={styles.field}>
                <span className={styles.label}>Lead ID or Phone Number</span>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    if (error) setError("");
                    if (similar.length) setSimilar([]);
                  }}
                  placeholder="LEAD-1001 or 9876543210"
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

              {similar.length > 0 && (
                <div className={styles.similar} role="status">
                  <p className={styles.similarLede}>
                    Similar customer{similar.length > 1 ? "s" : ""} already on file — is this one of them?
                  </p>
                  {similar.map((lead) => (
                    <div key={lead.leadId} className={styles.similarItem}>
                      <span className={styles.similarName}>
                        {lead.name} <span className={styles.similarMeta}>({lead.leadId}, {lead.phone})</span>
                      </span>
                      <div className={styles.similarActions}>
                        <button
                          type="button"
                          className={styles.similarUse}
                          onClick={() => pickSuggestedLead(lead)}
                        >
                          Use this lead
                        </button>
                      </div>
                    </div>
                  ))}
                  <button type="button" className={styles.similarDismiss} onClick={dismissSuggestions}>
                    This is a different customer
                  </button>
                </div>
              )}

              <button type="submit" className={styles.submit} disabled={searching} aria-busy={searching}>
                {searching ? (
                  <>
                    <Spinner size={14} />
                    Searching…
                  </>
                ) : (
                  <>Find Customer&nbsp;&#8599;</>
                )}
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
        ) : (
          <div className={styles.result}>
            <div className={styles.eyebrow}>Customer Found</div>
            <h2 className={styles.resultName}>{match.name}</h2>
            <span className={styles.resultStatus}>{match.leadStatus}</span>
            {match.previousVisits > 0 && (
              <p className={styles.repeatVisitNote}>
                This customer has visited {match.previousVisits} time{match.previousVisits > 1 ? "s" : ""} before — high intent.
              </p>
            )}

            <div className={styles.grid}>
              <div className={styles.gridItem}>
                <span className={styles.gridLabel}>Lead ID</span>
                <span className={styles.gridValue}>{match.leadId}</span>
              </div>
              <div className={styles.gridItem}>
                <span className={styles.gridLabel}>Phone</span>
                <span className={styles.gridValue}>{match.phone}</span>
              </div>
              <div className={styles.gridItem}>
                <span className={styles.gridLabel}>Budget</span>
                <span className={styles.gridValue}>{match.budget}</span>
              </div>
              <div className={styles.gridItem}>
                <span className={styles.gridLabel}>Preferred Project</span>
                <span className={styles.gridValue}>{match.preferredProject}</span>
              </div>
              <div className={styles.gridItem}>
                <span className={styles.gridLabel}>Interested Tower</span>
                <span className={styles.gridValue}>{match.interestedTower}</span>
              </div>
              <div className={styles.gridItem}>
                <span className={styles.gridLabel}>Previous Visits</span>
                <span className={styles.gridValue}>{match.previousVisits}</span>
              </div>
              <div className={styles.gridItem}>
                <span className={styles.gridLabel}>Family Size</span>
                <span className={styles.gridValue}>{match.familySize}</span>
              </div>
              <div className={styles.gridItem}>
                <span className={styles.gridLabel}>Loan Required</span>
                <span className={styles.gridValue}>{match.loanRequirement ? "Yes" : "No"}</span>
              </div>
            </div>

            <button
              type="button"
              className={styles.submit}
              onClick={() => start(match, "start")}
              disabled={leaving !== null}
              aria-busy={leaving === "start"}
            >
              {leaving === "start" ? (
                <>
                  <Spinner size={14} />
                  Starting session…
                </>
              ) : (
                <>Start Session&nbsp;&#8599;</>
              )}
            </button>

            <button type="button" className={styles.back} onClick={() => setMatch(null)}>
              Search a different customer
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
