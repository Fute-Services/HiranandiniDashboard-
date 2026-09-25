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

/** A lead our overlay has never seen: just the ID that was typed. The rest
 * of the fields exist so the presentation, which always expects a whole lead,
 * has something to attach itself to. */
function leadFromId(leadId) {
  return {
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

    // Not looked up in Sperto: the only Sperto API this app calls is
    // api_record_device_usage.php. The Lead ID typed is taken as given and
    // goes out as lead_id on OUT. Our own entry wins when we have one — it
    // carries the claim and status this app set.
    return res.json({ exact: findStoredLead(query) ?? leadFromId(query), similar: [] });
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
