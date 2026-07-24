"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SPACE_PATH } from "@/lib/auth";
import { createWalkInLead, findLead, type Lead } from "@/lib/leads";
import { setActiveSession } from "@/lib/session";
import { BackButton } from "./BackButton";
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

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    const lead = findLead(query);
    if (!lead) {
      setError(`No customer found for "${query.trim()}". Check the Lead ID or phone number.`);
      setMatch(null);
      return;
    }
    setError("");
    setMatch(lead);
  }

  function start(lead: Lead) {
    setActiveSession(lead);
    router.push(SPACE_PATH);
  }

  return (
    <div className={styles.page}>
      <BackButton />
      <div className={styles.card}>
        {!match ? (
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

              <button type="submit" className={styles.submit}>
                Find Customer&nbsp;&#8599;
              </button>
            </form>

            <button
              type="button"
              className={styles.walkin}
              onClick={() => start(createWalkInLead())}
            >
              Continue without a Lead ID
            </button>
          </>
        ) : (
          <div className={styles.result}>
            <div className={styles.eyebrow}>Customer Found</div>
            <h2 className={styles.resultName}>{match.name}</h2>
            <span className={styles.resultStatus}>{match.leadStatus}</span>

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

            <button type="button" className={styles.submit} onClick={() => start(match)}>
              Start Presentation&nbsp;&#8599;
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
