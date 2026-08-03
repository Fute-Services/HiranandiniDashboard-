import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSql } from "@/lib/db";
import { withJsonErrors } from "@/lib/api";
import { isSameOrigin } from "@/lib/csrf";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";
import { AUTH_COOKIE } from "@/lib/auth";
import { verifySessionToken } from "@/lib/session-token";

/**
 * Real customer/lead directory (see scripts/db/schema.sql's `leads` table),
 * replacing the hardcoded mock array `src/lib/leads.ts` used to export
 * directly. Same reasoning as /api/controls: a manager reassigning or
 * re-statusing a lead and the staff member searching for it are on separate
 * devices, so this has to be a real server-side store.
 */

type Row = {
  lead_id: string;
  phone: string;
  name: string;
  budget: string;
  preferred_project: string;
  lead_status: string;
  previous_visits: number;
  interested_tower: string;
  family_size: number;
  loan_requirement: boolean;
  assigned_staff_email: string | null;
  created_at: number;
};

function toLead(r: Row) {
  return {
    leadId: r.lead_id,
    phone: r.phone,
    name: r.name,
    budget: r.budget,
    preferredProject: r.preferred_project,
    leadStatus: r.lead_status,
    previousVisits: r.previous_visits,
    interestedTower: r.interested_tower,
    familySize: r.family_size,
    loanRequirement: r.loan_requirement,
    assignedStaffEmail: r.assigned_staff_email,
    // BIGINT columns come back from the driver as strings (avoids silent
    // precision loss on values bigger than Number.MAX_SAFE_INTEGER) — cast
    // back to a number here so every caller can rely on the declared type
    // instead of each one needing to know this detail.
    createdAt: Number(r.created_at),
  };
}

/** Admin-only gate for the delete action — customer-data deletion is more
 * sensitive than the block/reassign/status actions this route otherwise
 * treats as page-level-gated, so it's checked here too, not just trusted to
 * the admin dashboard UI that calls it. */
async function requireAdmin(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(AUTH_COOKIE)?.value;
  const secret = process.env.SESSION_SECRET;
  if (!token || !secret) return false;
  const payload = await verifySessionToken(token, secret);
  return payload?.role === "admin";
}

/** Last 10 digits, ignoring +91/country-code/dash/space formatting
 * differences — enough to tell "same phone, different formatting" apart
 * from "different phone" without a full phone-parsing library. */
function normalizedPhoneDigits(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

/** True if `a` and `b` are the same name up to case/whitespace/typo-scale
 * differences. The lead directory is small (a mock-scale sales floor, not a
 * national CRM), so comparing against every row per search is cheap enough
 * that this doesn't need a database-side fuzzy-match extension. */
function namesLookAlike(a: string, b: string): boolean {
  const na = a.trim().toLowerCase();
  const nb = b.trim().toLowerCase();
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  return levenshtein(na, nb) <= 2;
}

function levenshtein(a: string, b: string): number {
  const dp: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
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

export const GET = withJsonErrors(async (req: NextRequest) => {
  const sql = getSql();

  if (req.nextUrl.searchParams.get("all") === "1") {
    const rows = (await sql`SELECT * FROM leads ORDER BY created_at DESC`) as Row[];
    return NextResponse.json({ leads: rows.map(toLead) });
  }

  const query = req.nextUrl.searchParams.get("query")?.trim() ?? "";
  if (!query) return NextResponse.json({ exact: null, similar: [] });

  const rows = (await sql`SELECT * FROM leads`) as Row[];

  const normalized = query.toLowerCase().replace(/\s+/g, "");
  const exactRow = rows.find((r) => r.lead_id.toLowerCase() === normalized || r.phone === normalized);

  if (exactRow) return NextResponse.json({ exact: toLead(exactRow), similar: [] });

  const queryDigits = normalizedPhoneDigits(query);
  const similar = rows.filter((r) => {
    const phoneMatch = queryDigits.length >= 6 && normalizedPhoneDigits(r.phone) === queryDigits;
    const nameMatch = namesLookAlike(query, r.name);
    return phoneMatch || nameMatch;
  });

  return NextResponse.json({ exact: null, similar: similar.map(toLead) });
});

export const POST = withJsonErrors(async (req: NextRequest) => {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }
  if (!checkRateLimit(`leads:${clientKey(req)}`, 300, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const body = await req.json();
  const { action } = body as { action: string };
  const sql = getSql();

  if (action === "create_walkin") {
    const leadId = `WALKIN-${Date.now()}`;
    const createdAt = Date.now();
    await sql`
      INSERT INTO leads (lead_id, phone, name, budget, preferred_project, lead_status, previous_visits, interested_tower, family_size, loan_requirement, created_at)
      VALUES (${leadId}, '', 'Walk-in Customer', '', '', 'New', 0, '', 0, false, ${createdAt})
    `;
    return NextResponse.json({
      lead: {
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
        createdAt,
      },
    });
  }

  if (action === "claim") {
    // A different staff member starting a session with an already-assigned
    // lead is exactly the ownership-dispute scenario this audit trail exists
    // for — recorded once, here, rather than trusting whoever's involved to
    // report it after the fact.
    const { leadId, staffEmail, staffName } = body as { leadId: string; staffEmail: string; staffName: string };
    if (!leadId || !staffEmail) return NextResponse.json({ error: "leadId, staffEmail required" }, { status: 400 });

    const rows = (await sql`SELECT assigned_staff_email FROM leads WHERE lead_id = ${leadId}`) as {
      assigned_staff_email: string | null;
    }[];
    const previousOwner = rows[0]?.assigned_staff_email ?? null;

    await sql`UPDATE leads SET assigned_staff_email = ${staffEmail} WHERE lead_id = ${leadId}`;

    if (previousOwner && previousOwner !== staffEmail) {
      await sql`
        INSERT INTO activity_events (id, session_id, staff_email, staff_name, manager_email, lead_id, lead_name, type, label, at)
        VALUES (
          ${crypto.randomUUID()}, ${"leads-" + leadId}, ${staffEmail}, ${staffName ?? staffEmail}, NULL,
          ${leadId}, NULL, 'lead_reassigned',
          ${`Reassigned from ${previousOwner} to ${staffEmail}`}, ${Date.now()}
        )
      `;
    }
    return NextResponse.json({ ok: true, reassignedFrom: previousOwner !== staffEmail ? previousOwner : null });
  }

  if (action === "set_status") {
    const { leadId, status } = body as { leadId: string; status: string };
    if (!leadId || !status) return NextResponse.json({ error: "leadId, status required" }, { status: 400 });
    await sql`UPDATE leads SET lead_status = ${status} WHERE lead_id = ${leadId}`;
    return NextResponse.json({ ok: true });
  }

  if (action === "delete_lead") {
    if (!(await requireAdmin(req))) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    const { leadId } = body as { leadId: string };
    if (!leadId) return NextResponse.json({ error: "leadId required" }, { status: 400 });

    await sql`DELETE FROM leads WHERE lead_id = ${leadId}`;
    // Scrubs the customer's name from their activity history (the phone
    // number was never stored there — only in the now-deleted `leads` row)
    // while leaving the events themselves in place: they're staff
    // accountability records (who did what, when), not the customer's data,
    // and this route's own audit log needs the append-only guarantee to hold
    // for everyone else's history too.
    await sql`UPDATE activity_events SET lead_name = NULL WHERE lead_id = ${leadId}`;
    await sql`
      INSERT INTO activity_events (id, session_id, staff_email, staff_name, manager_email, lead_id, lead_name, type, label, at)
      VALUES (${crypto.randomUUID()}, ${"leads-" + leadId}, 'admin', 'Admin', NULL, ${leadId}, NULL, 'status', 'Customer data deleted', ${Date.now()})
    `;
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
});
