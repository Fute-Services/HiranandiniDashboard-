/**
 * The API's own state, held in this process's memory — no database, and
 * deliberately none.
 *
 * The customer data this app works with belongs to the client and lives in
 * their CRM (Sperto, see ./sperto.js). We do not keep a copy of it: there is
 * no `DATABASE_URL`, no Postgres, no table of leads or staff history
 * anywhere on our side. What is left here is only the small amount of
 * coordination state that cannot live in a browser, for the reason
 * routes/controls.js spells out — a sales manager and a sales staff member
 * are signed in on two different devices, so "this staff member has been
 * signed out" has to be readable from a browser other than the one it was
 * set in.
 *
 * The honest ceiling of that: this is process memory. A restart, a redeploy,
 * or (on a serverless host) a cold start clears it, and two instances behind
 * a load balancer do not share it. Everything below is written to treat an
 * empty store as the ordinary starting state rather than an error — an
 * unknown email is simply an account nobody has kicked or suspended, and an
 * unknown project slug is simply one with no unit count entered. Nothing in
 * the sales flow breaks when this is empty, which is what makes losing it
 * acceptable.
 *
 * The activity log is *not* here. It is per-browser, in sessionStorage —
 * see src/lib/activity-store.js.
 */

/** What a staff account looks like before anyone has acted on it. Returned
 * as a fresh object each time so a caller mutating the result can't
 * accidentally rewrite the default for everyone else. */
function defaultControls() {
  return {
    kicked: false,
    blockedProjects: [],
    loginSuspended: false,
    currentSessionId: null,
  };
}

/** email -> controls. @see defaultControls */
const controls = new Map();

export function getControls(email) {
  return { ...defaultControls(), ...(controls.get(email) ?? {}) };
}

/** Merges `patch` into an account's controls, creating the entry if this is
 * the first thing ever done to it. Returns the result so callers that echo
 * the new state back don't need a second read. */
export function setControls(email, patch) {
  const next = { ...getControls(email), ...patch };
  controls.set(email, next);
  return next;
}

/**
 * Records this login as the account's one active session, so a second
 * concurrent sign-in elsewhere can eject the first (see routes/controls.js's
 * `sessionInvalid`). Also clears `kicked`: signing in again is exactly the
 * point at which a previous force-logout has been served.
 */
export function startSession(email, sessionId) {
  return setControls(email, { currentSessionId: sessionId, kicked: false });
}

/** slug -> units left, as manually entered by an admin. A slug that was
 * never entered is absent rather than zero — "not set" and "none left" are
 * different answers, and only the admin's own number may be shown. */
const inventory = new Map();

export function getInventory() {
  return Object.fromEntries(inventory);
}

export function setInventory(slug, unitsLeft) {
  if (unitsLeft === null) inventory.delete(slug);
  else inventory.set(slug, unitsLeft);
}

/**
 * Admin-created staff/manager accounts, keyed by lowercased email.
 *
 * The demo roster in src/lib/users.js is separate and stays where it is —
 * it ships in the browser bundle, so a real account's password hash must
 * never be added to it (see ./users.js). These accounts exist for as long as
 * the process does; an admin adding staff after a restart adds them again.
 */
const users = new Map();

export function listUsers() {
  return [...users.values()];
}

export function findUserByEmail(email) {
  return users.get(email.trim().toLowerCase()) ?? null;
}

export function findUserBySpertoLogin(salesId) {
  const normalized = salesId.trim().toLowerCase();
  return listUsers().find((u) => u.spertoLogin?.trim().toLowerCase() === normalized) ?? null;
}

export function addUser(user) {
  const email = user.email.trim().toLowerCase();
  users.set(email, { ...user, email });
  return users.get(email);
}

/**
 * Leads the staff flow created or touched during this process's life —
 * walk-ins with no Lead ID, plus the claim/status changes made on leads
 * Sperto vouched for.
 *
 * Sperto remains the directory of record: nothing here is a source of
 * customer data, only a thin overlay of what this app did to a lead. A lead
 * absent from this map is not a lead that doesn't exist; it is one nobody
 * has claimed or re-statused yet on this instance.
 */
const leads = new Map();

export function listLeads() {
  return [...leads.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export function findLead(query) {
  const normalized = query.trim().toLowerCase().replace(/\s+/g, "");
  return (
    listLeads().find(
      (l) => l.leadId.toLowerCase() === normalized || l.phone.replace(/\s+/g, "") === normalized,
    ) ?? null
  );
}

export function putLead(lead) {
  leads.set(lead.leadId, lead);
  return lead;
}

/** Applies `patch` to a lead, or creates it from `patch` plus the blank
 * fields every caller expects a whole lead to have. The showcase always
 * renders a complete lead, so a partial one must never reach it. */
export function updateLead(leadId, patch) {
  const existing = leads.get(leadId);
  const next = existing
    ? { ...existing, ...patch }
    : {
        leadId,
        phone: "",
        name: leadId,
        budget: "",
        preferredProject: "",
        leadStatus: "New",
        previousVisits: 0,
        interestedTower: "",
        familySize: 0,
        loanRequirement: false,
        assignedStaffEmail: null,
        createdAt: Date.now(),
        ...patch,
      };
  leads.set(leadId, next);
  return next;
}

export function deleteLead(leadId) {
  return leads.delete(leadId);
}

/**
 * Forgets everything this staff member's sitting left behind. Called on
 * sign-out (routes/logout.js), so the rule the browser side already follows
 * — nothing outlives the session — holds on this side too.
 *
 * Two kinds go:
 *
 * - Leads assigned to them. Every lead that reaches a presentation is
 *   claimed first (see SessionStart's confirmDevice), so this is exactly the
 *   set their session touched.
 * - Unclaimed walk-ins. A walk-in exists only to give a presentation
 *   something to attach to, and one nobody claimed is a presentation that
 *   never started. Dropping another staff member's in-flight walk-in is
 *   harmless: their claim recreates the entry (see `updateLead`).
 *
 * What deliberately stays is in `controls` — a suspension has to outlive the
 * sign-out it caused, or a force-logout would be undone by the very logout
 * it triggers.
 */
export function dropLeadsForStaff(email) {
  for (const [leadId, lead] of leads) {
    const theirs = lead.assignedStaffEmail === email;
    const orphanWalkIn = lead.assignedStaffEmail === null && leadId.startsWith("WALKIN-");
    if (theirs || orphanWalkIn) leads.delete(leadId);
  }
}
