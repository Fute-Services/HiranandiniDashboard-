/**
 * Client for the real customer/lead directory (`/api/leads`, backed by
 * Postgres — see scripts/db/schema.sql's `leads` table). Used to be a
 * hardcoded in-memory array standing in for the Sperto/CRM lookup this app
 * doesn't have API access to yet; now a real table so assignment and status
 * changes actually persist across staff/manager/admin, who are on separate
 * devices in real use.
 */
import { DUMMY_CUSTOMERS, findDummyCustomer } from "@/data/customers";
import { fetchWithTimeout, readJsonSafe } from "./http";

export type LeadStatus = "New" | "Follow-up" | "Hot" | "Negotiation" | "Booked" | "Lost";

export type Lead = {
  leadId: string;
  phone: string;
  name: string;
  budget: string;
  preferredProject: string;
  leadStatus: LeadStatus;
  previousVisits: number;
  interestedTower: string;
  familySize: number;
  loanRequirement: boolean;
  /** Which staff member currently "owns" this lead — set on first claim and
   * updated (with an audit event) if a different staff member claims it
   * afterwards. Null until anyone has. */
  assignedStaffEmail: string | null;
  /** Epoch ms — drives the 30-day retention window (see `isStaleLead`). */
  createdAt: number;
};

/** True once a lead is more than 30 days old — the default Leads tab view
 * hides these ("auto-archive") rather than deleting anything; an explicit
 * toggle reveals them, and `deleteLead` is the only thing that actually
 * removes a record. */
export function isStaleLead(lead: Pick<Lead, "createdAt">, now: number): boolean {
  return now - lead.createdAt > 30 * 24 * 60 * 60 * 1000;
}

/**
 * Matches on Customer ID or phone number, case/space-insensitive, exact only.
 * Never throws: a failed lookup reads the same as "no match" to the caller.
 *
 * Falls back to the dummy directory (src/data/customers.ts) whenever the API
 * can't answer — no database configured, request failed, or simply no such
 * row. That fallback is what makes the staff flow demonstrable before the
 * client's customer API exists; delete it, and this function's network path,
 * once that API is wired up.
 */
export async function findLead(query: string): Promise<Lead | null> {
  try {
    const res = await fetchWithTimeout(`/api/leads?query=${encodeURIComponent(query)}`);
    if (res.ok) {
      const data = await readJsonSafe<{ exact: Lead | null }>(res);
      if (data?.exact) return data.exact;
    }
  } catch {
    // fall through to the dummy directory
  }
  return findDummyCustomer(query);
}

/**
 * A presentation started without a valid Lead ID (questionnaire §2's edge
 * case). Creates a real (if throwaway) row so the rest of the flow, which
 * always expects an active lead, has something to attach the session to.
 * Falls back to a client-only placeholder if the request fails outright —
 * the presentation still has to be able to start.
 */
export async function createWalkInLead(): Promise<Lead> {
  const fallback: Lead = {
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
    const data = await readJsonSafe<{ lead: Lead }>(res);
    return data?.lead ?? fallback;
  } catch {
    return fallback;
  }
}

/** Claims a lead for the staff member starting a session with it. If it was
 * previously assigned to someone else, the server logs a `lead_reassigned`
 * activity event — this is the ownership audit trail, not something the
 * caller has to build. Best-effort: a failed claim shouldn't block the
 * presentation from starting. */
export async function claimLead(leadId: string, staffEmail: string, staffName: string): Promise<void> {
  try {
    await fetchWithTimeout("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "claim", leadId, staffEmail, staffName }),
      keepalive: true,
    });
  } catch {
    // best-effort; ignore
  }
}

/** Admin/manager action: sets a lead's final pipeline status (e.g. Booked or
 * Lost), so the funnel from presentation to sale can actually be measured. */
export async function setLeadStatus(leadId: string, status: LeadStatus): Promise<boolean> {
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
 * request, e.g. GDPR-style) — the server also scrubs their name from linked
 * activity events while leaving the events themselves (staff accountability
 * records) in place. This is the only thing in the leads/activity system
 * that actually removes data rather than just hiding or superseding it. */
export async function deleteLead(leadId: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete_lead", leadId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Full lead directory for the admin/manager Leads tab. Falls back to the
 * dummy directory for the same reason `findLead` does — so the tab shows the
 * customers the staff flow can actually be demonstrated with, rather than an
 * empty table, until the real API is wired up. */
export async function listLeads(): Promise<Lead[]> {
  try {
    const res = await fetchWithTimeout("/api/leads?all=1");
    if (res.ok) {
      const data = await readJsonSafe<{ leads: Lead[] }>(res);
      if (Array.isArray(data?.leads) && data.leads.length > 0) return data.leads;
    }
  } catch {
    // fall through to the dummy directory
  }
  return DUMMY_CUSTOMERS;
}
