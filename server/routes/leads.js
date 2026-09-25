import { Router } from "express";
import {
  deleteLead as removeLead,
  findLead as findStoredLead,
  listLeads as listStoredLeads,
  putLead,
  updateLead,
} from "../lib/store.js";
import { withJsonErrors } from "../lib/api.js";
import { isSameOrigin } from "../lib/csrf.js";
import { checkRateLimit, clientKey } from "../lib/rate-limit.js";
import { getViewer } from "../lib/viewer.js";
import { isSpertoConfigured, spertoLeadExists } from "../lib/sperto.js";

/**
 * Customer/lead lookup.
 *
 * Sperto owns the customer list — it is the client's CRM and their data, and
 * we keep no copy of it. What this route holds (server/lib/store.js) is only
 * a thin overlay of what *this app* did to a lead during the life of the
 * process: who claimed it, what status a manager set, and the walk-ins
 * created for presentations that started without a Lead ID. None of that is
 * customer data we are storing on their behalf; all of it is disposable.
 *
 * It stays server-side rather than in the browser for the same reason
 * /api/controls does: a manager reassigning or re-statusing a lead and the
 * staff member searching for it are on separate devices.
 */
export const leadsRouter = Router();

/** Admin-only gate for the delete action — customer-data deletion is more
 * sensitive than the block/reassign/status actions this route otherwise
 * treats as page-level-gated, so it's checked here too, not just trusted to
 * the admin dashboard UI that calls it. */
async function isAdmin(req) {
  const viewer = await getViewer(req);
  return viewer?.role === "admin";
}

/** Last 10 digits, ignoring +91/country-code/dash/space formatting
 * differences — enough to tell "same phone, different formatting" apart
 * from "different phone" without a full phone-parsing library. */
function normalizedPhoneDigits(phone) {
  return phone.replace(/\D/g, "").slice(-10);
}

/** True if `a` and `b` are the same name up to case/whitespace/typo-scale
 * differences. The overlay is small (one showroom's sitting, not a national
 * CRM), so comparing against every entry per search is cheap. */
function namesLookAlike(a, b) {
  const na = a.trim().toLowerCase();
  const nb = b.trim().toLowerCase();
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  return levenshtein(na, nb) <= 2;
}

function levenshtein(a, b) {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[b.length];
}

/** A lead Sperto vouched for that our overlay has never seen. Still a valid
 * customer — that is the point of letting the CRM own the list — it just
 * arrives with only the two things they told us: the ID that was typed, and
 * whatever name came back. The rest of the fields exist so the presentation,
 * which always expects a whole lead, has something to attach itself to. */
function leadFromSperto(leadId, name) {
  return {
    leadId,
    phone: "",
    name: name ?? leadId,
    budget: "",
    preferredProject: "",
    leadStatus: "New",
    previousVisits: 0,
    interestedTower: "",
    familySize: 0,
    loanRequirement: false,
    assignedStaffEmail: null,
    createdAt: Date.now(),
  };
}

leadsRouter.get(
  "/",
  withJsonErrors(async (req, res) => {
    if (req.query.all === "1") {
      // Only what this instance has touched. An empty answer is the ordinary
      // case — the real customer list is Sperto's, not something this route
      // can enumerate.
      return res.json({ leads: listStoredLeads() });
    }

    const query = String(req.query.query ?? "").trim();
    if (!query) return res.json({ exact: null, similar: [] });

    /**
     * Sperto is asked first, and its "no" is final.
     *
     * The staff member's own sign-in already goes through that door; this is
     * the same door one screen later, for the customer. Sperto owns the
     * customer list exactly as it owns the staff list, so a Lead ID it does
     * not have is not a lead — checking only our own overlay would accept an
     * ID that is as trustworthy as whoever last typed it in.
     *
     * An outage is not a rejection. `unavailable` falls through to the local
     * lookup below rather than blocking: a CRM that is down must not be able
     * to stop a presentation that has a customer already sitting in front of
     * it, which is the same call `/api/login` makes for admins.
     */
    if (isSpertoConfigured()) {
      const check = await spertoLeadExists(query);

      if (!check.ok && check.reason === "not_found") {
        return res.json({
          exact: null,
          similar: [],
          rejected: true,
          error: "That Lead ID isn't registered in Sperto.",
        });
      }

      if (check.ok) {
        // Our own entry wins when we have one: it carries the claim and the
        // status this app set, which Sperto's four-field answer has no room
        // for. Their name fills the gap when we don't.
        const local = findStoredLead(query);
        return res.json({
          exact: local ?? leadFromSperto(query, check.name),
          similar: [],
          source: "sperto",
        });
      }

      console.error("[leads] Sperto lead check failed:", check.message);
      // Falls through — unavailable, so answer from whatever we have.
    }

    const exact = findStoredLead(query);
    if (exact) return res.json({ exact, similar: [] });

    const queryDigits = normalizedPhoneDigits(query);
    const similar = listStoredLeads().filter((l) => {
      const phoneMatch = queryDigits.length >= 6 && normalizedPhoneDigits(l.phone) === queryDigits;
      return phoneMatch || namesLookAlike(query, l.name);
    });

    return res.json({ exact: null, similar });
  }),
);

leadsRouter.post(
  "/",
  withJsonErrors(async (req, res) => {
    if (!isSameOrigin(req)) {
      return res.status(403).json({ error: "Invalid origin" });
    }
    if (!checkRateLimit(`leads:${clientKey(req)}`, 300, 60_000)) {
      return res.status(429).json({ error: "Too many requests" });
    }

    const body = req.body ?? {};
    const { action } = body;

    // Admin-gated actions are checked before anything is read or written, so
    // a staff member's attempt to delete a customer is refused on
    // authorisation rather than on whatever the store happened to hold.
    if (action === "delete_lead" && !(await isAdmin(req))) {
      return res.status(403).json({ error: "Admin access required" });
    }

    if (action === "create_walkin") {
      const leadId = `WALKIN-${Date.now()}`;
      const lead = putLead({
        leadId,
        phone: "",
        name: "Walk-in Customer",
        budget: "",
        preferredProject: "",
        leadStatus: "New",
        previousVisits: 0,
        interestedTower: "",
        familySize: 0,
        loanRequirement: false,
        assignedStaffEmail: null,
        createdAt: Date.now(),
      });
      return res.json({ lead });
    }

    if (action === "claim") {
      const { leadId, staffEmail } = body;
      if (!leadId || !staffEmail) return res.status(400).json({ error: "leadId, staffEmail required" });

      const previousOwner = findStoredLead(leadId)?.assignedStaffEmail ?? null;
      updateLead(leadId, { assignedStaffEmail: staffEmail });

      // A different staff member starting a session with an already-assigned
      // lead is an ownership dispute worth recording. The log is the
      // browser's now (src/lib/activity-store.js), so this reports the
      // previous owner back and the caller writes the `lead_reassigned`
      // event — see src/lib/leads.js's claimLead.
      return res.json({
        ok: true,
        reassignedFrom: previousOwner && previousOwner !== staffEmail ? previousOwner : null,
      });
    }

    if (action === "set_status") {
      const { leadId, status } = body;
      if (!leadId || !status) return res.status(400).json({ error: "leadId, status required" });
      updateLead(leadId, { leadStatus: status });
      return res.json({ ok: true });
    }

    if (action === "delete_lead") {
      // Authorisation already checked at the top — see the note there.
      const { leadId } = body;
      if (!leadId) return res.status(400).json({ error: "leadId required" });

      const leadName = findStoredLead(leadId)?.name ?? "";
      removeLead(leadId);

      // Scrubbing the customer's name out of the activity timeline is the
      // caller's half of this, for the same reason as `claim` above: the log
      // is in the browser. `leadName` goes back so it knows what to scrub —
      // empty for a walk-in with no real name, which is a no-op there.
      return res.json({ ok: true, leadName });
    }

    return res.status(400).json({ error: "unknown action" });
  }),
);
