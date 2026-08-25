/**
 * Dummy customer directory — the seam where the client's real customer API
 * plugs in.
 *
 * `lib/leads.ts` asks `/api/leads` (Postgres) first and falls back to this
 * list, so the staff flow works end-to-end with no database and no API
 * credentials. When the real API lands, the only thing that has to change is
 * `findDummyCustomer` below: point it at the API (or delete it and let
 * `findLead`'s network path be the only one). Nothing else in the login →
 * customer → device → showcase flow reads this file.
 *
 * Keep these in the same shape as `Lead` so the swap is a one-file change.
 */
import type { Lead } from "@/lib/leads";

/** Fixed timestamp, not Date.now() — these are seed rows, and a "created just
 * now" date would make every dummy customer permanently un-archivable in the
 * admin Leads tab (see `isStaleLead`). */
const SEEDED_AT = Date.parse("2026-07-01T00:00:00Z");

export const DUMMY_CUSTOMERS: Lead[] = [
  {
    leadId: "LEAD-1001",
    phone: "9876543210",
    name: "Rohit Sharma",
    budget: "₹1.8 Cr – ₹2.2 Cr",
    preferredProject: "Hiranandani Fortune City",
    leadStatus: "Hot",
    previousVisits: 2,
    interestedTower: "Tower B",
    familySize: 4,
    loanRequirement: true,
    assignedStaffEmail: null,
    createdAt: SEEDED_AT,
  },
  {
    leadId: "LEAD-1002",
    phone: "9820011223",
    name: "Anjali Deshpande",
    budget: "₹95 L – ₹1.2 Cr",
    preferredProject: "Hiranandani Estate",
    leadStatus: "Follow-up",
    previousVisits: 1,
    interestedTower: "Tower A",
    familySize: 3,
    loanRequirement: true,
    assignedStaffEmail: null,
    createdAt: SEEDED_AT,
  },
  {
    leadId: "LEAD-1003",
    phone: "9004556677",
    name: "Imran Qureshi",
    budget: "₹2.5 Cr+",
    preferredProject: "Hiranandani Gardens",
    leadStatus: "Negotiation",
    previousVisits: 3,
    interestedTower: "Tower D",
    familySize: 5,
    loanRequirement: false,
    assignedStaffEmail: null,
    createdAt: SEEDED_AT,
  },
  {
    leadId: "LEAD-1004",
    phone: "9930778899",
    name: "Meera Nair",
    budget: "₹70 L – ₹90 L",
    preferredProject: "Hiranandani Fortune City",
    leadStatus: "New",
    previousVisits: 0,
    interestedTower: "Tower C",
    familySize: 2,
    loanRequirement: true,
    assignedStaffEmail: null,
    createdAt: SEEDED_AT,
  },
  {
    leadId: "LEAD-1005",
    phone: "9167334455",
    name: "Sanjay Patel",
    budget: "₹1.4 Cr – ₹1.7 Cr",
    preferredProject: "Hiranandani Estate",
    leadStatus: "Follow-up",
    previousVisits: 1,
    interestedTower: "Tower B",
    familySize: 4,
    loanRequirement: false,
    assignedStaffEmail: null,
    createdAt: SEEDED_AT,
  },
];

/** Matches a Customer ID or phone number, case- and space-insensitive.
 * Exact only — a partial match would be a guess, and the staff member is
 * reading the ID off a CRM screen, not typing it from memory. */
export function findDummyCustomer(query: string): Lead | null {
  const q = query.trim().toLowerCase().replace(/\s+/g, "");
  if (!q) return null;
  return (
    DUMMY_CUSTOMERS.find(
      (c) => c.leadId.toLowerCase() === q || c.phone.replace(/\D/g, "") === q.replace(/\D/g, ""),
    ) ?? null
  );
}
