/**
 * Client for the customer/lead lookup (`/api/leads`).
 *
 * Sperto owns the customer list — it is the client's CRM and their data, and
 * this app keeps no copy of it. The API holds only a thin, disposable
 * overlay of what this app did to a lead (who claimed it, what status a
 * manager set, walk-ins created for presentations that started without a
 * Lead ID), which is server-side rather than in the browser only because the
 * manager and the staff member are on separate devices.
 *
 * A lead is `{ leadId, phone, name, budget, preferredProject, leadStatus,
 * previousVisits, interestedTower, familySize, loanRequirement,
 * assignedStaffEmail, createdAt }`. `assignedStaffEmail` is which staff
 * member currently "owns" the lead — set on first claim and updated (with an
 * audit event) if a different staff member claims it afterwards, null until
 * anyone has. `createdAt` is epoch ms and drives the 30-day retention window
 * (see `isStaleLead`).
 */
import { DUMMY_CUSTOMERS, findDummyCustomer } from "@/data/customers";
import { actorFields, track } from "./activity";
import { scrubLead } from "./activity-store";
import { fetchWithTimeout, readJsonSafe } from "./http";

/** @typedef {"New" | "Follow-up" | "Hot" | "Negotiation" | "Booked" | "Lost"} LeadStatus */

export const LEAD_STATUSES = ["New", "Follow-up", "Hot", "Negotiation", "Booked", "Lost"];

/** True once a lead is more than 30 days old — the default Leads tab view
 * hides these ("auto-archive") rather than deleting anything; an explicit
 * toggle reveals them, and `deleteLead` is the only thing that actually
 * removes a record. */
export function isStaleLead(lead, now) {
  return now - lead.createdAt > 30 * 24 * 60 * 60 * 1000;
}

/**
 * Matches on Customer ID or phone number, case/space-insensitive, exact only.
 * Never throws.
 *
 * Resolves to `{ ok: true, lead }`, or `{ ok: false, error }` with something
 * the screen can show. The two are kept apart — rather than collapsing both
 * into `null` as this used to — because they are now genuinely different
 * answers: **Sperto rejecting a Lead ID is final**, and telling the staff
 * member "check the ID" when the CRM has actually refused it sends them off
 * to re-type something that was never going to work.
 *
 * Falls back to the dummy directory (src/data/customers.js) when the API
 * can't answer at all — no database configured, request failed — but never
 * over a rejection. That fallback is what makes the staff flow demonstrable
 * before the client's customer API exists; delete it, and this function's
 * network path, once that API is wired up.
 */
export async function findLead(query) {
  try {
    const res = await fetchWithTimeout(`/api/leads?query=${encodeURIComponent(query)}`);
    if (res.ok) {
      const data = await readJsonSafe(res);
      if (data?.exact) return { ok: true, lead: data.exact };
      // Sperto answered, and the answer was no. Final — no dummy fallback,
      // or a Lead ID the CRM has refused would still open a presentation.
      if (data?.rejected) {
        return { ok: false, error: data.error ?? "That Lead ID isn't registered in Sperto." };
      }
    }
  } catch {
    // fall through to the dummy directory
  }
  const dummy = findDummyCustomer(query);
  if (dummy) return { ok: true, lead: dummy };
  return {
    ok: false,
    error: `No customer found for "${query.trim()}". Check the Lead ID or phone number.`,
  };
}

/**
 * A presentation started without a valid Lead ID (questionnaire §2's edge
 * case). Creates a real (if throwaway) row so the rest of the flow, which
 * always expects an active lead, has something to attach the session to.
 * Falls back to a client-only placeholder if the request fails outright —
 * the presentation still has to be able to start.
 */
export async function createWalkInLead() {
  const fallback = {
    leadId: `WALKIN-${Date.now()}`,
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
  };
  try {
    const res = await fetchWithTimeout("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create_walkin" }),
    });
    if (!res.ok) return fallback;
    const data = await readJsonSafe(res);
    return data?.lead ?? fallback;
  } catch {
    return fallback;
  }
}

/** Claims a lead for the staff member starting a session with it. If it was
 * previously assigned to someone else, that is the ownership-dispute case
 * the audit trail exists for, so a `lead_reassigned` event is written here —
 * the log lives in this browser now (see lib/activity-store.js), so the API
 * reports the previous owner back and this records it rather than writing
 * the event itself. Best-effort: a failed claim shouldn't block the
 * presentation from starting. */
export async function claimLead(leadId, staffEmail, staffName) {
  try {
    const res = await fetchWithTimeout("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "claim", leadId, staffEmail, staffName }),
      keepalive: true,
    });
    if (!res.ok) return;
    const data = await readJsonSafe(res);
    if (data?.reassignedFrom) {
      track({
        sessionId: `leads-${leadId}`,
        type: "lead_reassigned",
        label: `Reassigned from ${data.reassignedFrom} to ${staffEmail}`,
        leadId,
        leadName: null,
        durationMs: null,
        ...actorFields(staffEmail, staffName ?? staffEmail),
      });
    }
  } catch {
    // best-effort; ignore
  }
}

/** Admin/manager action: sets a lead's final pipeline status (e.g. Booked or
 * Lost), so the funnel from presentation to sale can actually be measured. */
export async function setLeadStatus(leadId, status) {
  try {
    const res = await fetchWithTimeout("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_status", leadId, status }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Admin-only: permanently deletes a customer's lead record (a data-deletion
 * request, e.g. GDPR-style). Their name is then scrubbed from the linked
 * activity events while the events themselves (staff accountability records)
 * stay — done here rather than server-side because the log is this browser's
 * (see lib/activity-store.js), which also means it only reaches the log in
 * the tab the admin is deleting from. This is the only thing in the
 * leads/activity system that removes data rather than hiding or superseding
 * it. */
export async function deleteLead(leadId) {
  try {
    const res = await fetchWithTimeout("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete_lead", leadId }),
    });
    if (!res.ok) return false;
    const data = await readJsonSafe(res);
    scrubLead(leadId, data?.leadName ?? "");
    track({
      sessionId: `leads-${leadId}`,
      type: "status",
      label: "Customer data deleted",
      leadId,
      leadName: null,
      durationMs: null,
      staffEmail: "admin",
      staffName: "Admin",
      managerEmail: null,
    });
    return true;
  } catch {
    return false;
  }
}

/** Full lead directory for the admin/manager Leads tab. Falls back to the
 * dummy directory for the same reason `findLead` does — so the tab shows the
 * customers the staff flow can actually be demonstrated with, rather than an
 * empty table, until the real API is wired up. */
export async function listLeads() {
  try {
    const res = await fetchWithTimeout("/api/leads?all=1");
    if (res.ok) {
      const data = await readJsonSafe(res);
      if (Array.isArray(data?.leads) && data.leads.length > 0) return data.leads;
    }
  } catch {
    // fall through to the dummy directory
  }
  return DUMMY_CUSTOMERS;
}
