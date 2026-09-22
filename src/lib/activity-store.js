/**
 * Where the activity log lives: this browser tab's `sessionStorage`, and
 * nowhere else.
 *
 * There is no database behind this app and no server-side copy of the log.
 * The customer data belongs to the client and stays in their CRM; what this
 * file holds is the trail of what happened during one signed-in sitting —
 * which projects were opened, how long each was shown, what was searched —
 * so the reports screen has something to render while that sitting is still
 * going on.
 *
 * `sessionStorage`, not `localStorage`, is the deliberate part. It is scoped
 * to the tab: close it and the log is gone, and a second tab starts empty.
 * That is the intended lifetime — a showroom screen handed to the next
 * customer must not still be carrying the last one's session.
 *
 * Two consequences worth stating plainly, because they are not bugs:
 *
 * - **A manager sees only their own browser's log.** The log cannot cross
 *   devices without a server-side store, and there isn't one. Cross-device
 *   controls (force-logout, suspension) still work — those go through
 *   /api/controls — but staff activity does not travel with them.
 * - **It is the staff member's own browser.** Anyone who can open devtools
 *   can edit or clear it. The append-only guarantee a server endpoint used
 *   to provide does not survive the move into the tab.
 */

const KEY = "hiranandani.activity";

/** Same cap the log has always applied: one render, and one storage entry,
 * can never grow unbounded over a long sitting. Oldest events drop first. */
const MAX_EVENTS = 5000;

/**
 * Every `sessionStorage` access goes through these two.
 *
 * Reads and writes both throw in situations that are entirely ordinary —
 * Safari's private mode, storage disabled by policy, a full quota — and a
 * lost log line must never break a presentation. So a failed read is "no
 * events yet" and a failed write is silence, exactly as the fire-and-forget
 * network call this replaced behaved.
 */
function read() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(KEY) ?? "[]");
    // Hand-edited, or written by an older build. Start clean rather than
    // handing the dashboards rows they'll destructure into undefined.
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(events) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(events));
  } catch {
    // Quota or unavailable storage; best-effort by design.
  }
}

/** Appends one event and returns it. The id is generated here so the caller
 * gets the same `{ ok, id }` shape the API used to answer with. */
export function appendEvent(event) {
  const stored = {
    ...event,
    id: crypto.randomUUID(),
    at: Date.now(),
    // Held for shape compatibility with the reports, which render a location
    // column when there is one. It used to come from the CDN's geo headers;
    // in the browser there is no equivalent that doesn't ask for a
    // permission prompt mid-presentation, so it is simply absent.
    location: null,
  };
  const all = read();
  all.push(stored);
  write(all.length > MAX_EVENTS ? all.slice(all.length - MAX_EVENTS) : all);
  return stored;
}

/**
 * Filtered, oldest-first — the order the timeline components render in.
 *
 * `filters` is `{ managerEmail, staffEmail, leadId, project, from, to }`,
 * all optional. `project` is a case-insensitive substring matched against
 * the event label and the lead name, which is the same pair the log has
 * always searched.
 */
export function listEvents(filters = {}) {
  const { managerEmail, staffEmail, leadId, from, to } = filters;
  const project = filters.project?.toLowerCase();

  const matched = read().filter((e) => {
    if (managerEmail && e.managerEmail !== managerEmail) return false;
    if (staffEmail && e.staffEmail !== staffEmail) return false;
    if (leadId && e.leadId !== leadId) return false;
    if (from !== null && from !== undefined && e.at < from) return false;
    if (to !== null && to !== undefined && e.at > to) return false;
    if (project) {
      const haystack = `${e.label} ${e.leadName ?? ""}`.toLowerCase();
      if (!haystack.includes(project)) return false;
    }
    return true;
  });

  matched.sort((a, b) => a.at - b.at);
  return matched;
}

export function eventCount() {
  return read().length;
}

/**
 * A customer-data deletion, applied to the log.
 *
 * Their name is scrubbed from the linked events while the events themselves
 * stay: those are staff accountability records (who did what, when), not the
 * customer's data. The name landed in two places — the structured
 * `leadName`, and the free text of every label generated from it ("Opened
 * profile for Rohan Mehta") — so clearing the first alone would still leave
 * it readable in the timeline.
 */
export function scrubLead(leadId, leadName) {
  const all = read().map((e) => {
    if (e.leadId !== leadId) return e;
    return {
      ...e,
      leadName: null,
      label: leadName ? e.label.split(leadName).join("[deleted]") : e.label,
    };
  });
  write(all);
}

/** Drops everything. Sign-out calls this: the next person to pick up a
 * showroom screen starts with an empty log, not the last customer's. */
export function clearEvents() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Same best-effort contract as write().
  }
}
