/**
 * Mock lead/customer directory — stands in for the Sperto/CRM lookup this
 * app doesn't have API access to yet (see the "Client Requirement Discovery
 * Questionnaire", §2 and §5). Swap `findLead` for a real API call once those
 * docs/credentials land; nothing else in the capture flow should need to
 * change since callers only depend on this function's shape.
 */
export type Lead = {
  leadId: string;
  phone: string;
  name: string;
  budget: string;
  preferredProject: string;
  leadStatus: "New" | "Follow-up" | "Hot" | "Negotiation";
  previousVisits: number;
  interestedTower: string;
  familySize: number;
  loanRequirement: boolean;
};

export const LEADS: Lead[] = [
  {
    leadId: "LEAD-1001",
    phone: "9876543210",
    name: "Rohan Mehta",
    budget: "₹1.8 Cr – ₹2.2 Cr",
    preferredProject: "The Arena",
    leadStatus: "Hot",
    previousVisits: 2,
    interestedTower: "Arcadia",
    familySize: 4,
    loanRequirement: true,
  },
  {
    leadId: "LEAD-1002",
    phone: "9822011223",
    name: "Priya Nair",
    budget: "₹2.5 Cr – ₹3 Cr",
    preferredProject: "Elena",
    leadStatus: "Follow-up",
    previousVisits: 1,
    interestedTower: "Elena",
    familySize: 3,
    loanRequirement: true,
  },
  {
    leadId: "LEAD-1003",
    phone: "9900112233",
    name: "Arjun & Kavita Shah",
    budget: "₹3.2 Cr+",
    preferredProject: "Golden Willows",
    leadStatus: "Negotiation",
    previousVisits: 3,
    interestedTower: "Golden Willows",
    familySize: 5,
    loanRequirement: false,
  },
];

/** Matches on Lead ID or phone number, case/space-insensitive. */
export function findLead(query: string): Lead | null {
  const normalized = query.trim().toLowerCase().replace(/\s+/g, "");
  if (!normalized) return null;
  return (
    LEADS.find(
      (l) =>
        l.leadId.toLowerCase() === normalized ||
        l.phone === normalized,
    ) ?? null
  );
}

/**
 * A presentation started without a valid Lead ID (questionnaire §2's edge
 * case) — a placeholder lead so the rest of the flow (which always expects
 * an active lead) has something to attach the session to.
 */
export function createWalkInLead(): Lead {
  return {
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
  };
}
