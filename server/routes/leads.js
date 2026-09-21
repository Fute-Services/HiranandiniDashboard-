import { randomUUID } from "node:crypto";
import { Router } from "express";
import { getSql, hasDb } from "../lib/db.js";
import { withJsonErrors } from "../lib/api.js";
import { isSameOrigin } from "../lib/csrf.js";
import { checkRateLimit, clientKey } from "../lib/rate-limit.js";
import { getViewer } from "../lib/viewer.js";
import { isSpertoConfigured, spertoLeadExists } from "../lib/sperto.js";

/**
 * Real customer/lead directory (see scripts/db/schema.sql's `leads` table),
 * replacing the hardcoded mock array `src/lib/leads.js` used to export
 * directly. Same reasoning as /api/controls: a manager reassigning or
 * re-statusing a lead and the staff member searching for it are on separate
 * devices, so this has to be a real server-side store.
 */
export const leadsRouter = Router();

function toLead(r) {
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
    // back to a number here so every caller gets the shape it expects
    // instead of each one needing to know this detail.
    createdAt: Number(r.created_at),
  };
}

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
 * differences. The lead directory is small (a mock-scale sales floor, not a
 * national CRM), so comparing against every row per search is cheap enough
 * that this doesn't need a database-side fuzzy-match extension. */
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

/** A lead Sperto vouched for that our own table has never seen. Still a valid
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

/** Our own `leads` table, by Lead ID or phone, case/space-insensitive. Null
 * when there is no database at all, which is the ordinary local case. */
async function findLocalLead(query) {
  if (!hasDb()) return null;
  const sql = getSql();
  const rows = await sql`SELECT * FROM leads`;
  const normalized = query.toLowerCase().replace(/\s+/g, "");
  const row = rows.find((r) => r.lead_id.toLowerCase() === normalized || r.phone === normalized);
  return row ? toLead(row) : null;
}

leadsRouter.get(
  "/",
  withJsonErrors(async (req, res) => {
    if (req.query.all === "1") {
      // No DB configured means no real lead directory yet — the caller
      // (src/lib/leads.js's listLeads) falls back to the dummy directory on
      // an empty result, same as it does on a network failure.
      if (!hasDb()) return res.json({ leads: [] });
      const sql = getSql();
      const rows = await sql`SELECT * FROM leads ORDER BY created_at DESC`;
      return res.json({ leads: rows.map(toLead) });
    }

    const query = String(req.query.query ?? "").trim();
    if (!query) return res.json({ exact: null, similar: [] });

    /**
     * Sperto is asked first, and its "no" is final.
     *
     * The staff member's own sign-in already goes through that door; this is
     * the same door one screen later, for the customer. Sperto owns the
     * customer list exactly as it owns the staff list, so a Lead ID it does
     * not have is not a lead — checking only our own `leads` table would
     * accept an ID that is as trustworthy as whoever last typed it in.
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
        // Our own row wins when we have one: it carries budget, tower, family
        // size and the assignment history, none of which Sperto's four-field
        // answer has room for. Their name fills the gap when we don't.
        const local = await findLocalLead(query);
        return res.json({
          exact: local ?? leadFromSperto(query, check.name),
          similar: [],
          source: "sperto",
        });
      }

      console.error("[leads] Sperto lead check failed:", check.message);
      // Falls through — unavailable, so answer from whatever we have.
    }

    if (!hasDb()) return res.json({ exact: null, similar: [] });

    const exact = await findLocalLead(query);
    if (exact) return res.json({ exact, similar: [] });

    const sql = getSql();
    const rows = await sql`SELECT * FROM leads`;
    const queryDigits = normalizedPhoneDigits(query);
    const similar = rows.filter((r) => {
      const phoneMatch = queryDigits.length >= 6 && normalizedPhoneDigits(r.phone) === queryDigits;
      const nameMatch = namesLookAlike(query, r.name);
      return phoneMatch || nameMatch;
    });

    return res.json({ exact: null, similar: similar.map(toLead) });
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

    // Admin-gated actions are checked before anything touches the database.
    // With the check below `getSql()` — as it was — a staff member's attempt
    // to delete a customer answered 500 ("DATABASE_URL is not set") on an
    // instance with no database, which is both the wrong status and the wrong
    // story: the request was refused on authorisation, not on plumbing.
    if (action === "delete_lead" && !(await isAdmin(req))) {
      return res.status(403).json({ error: "Admin access required" });
    }

    // Every action below writes, and the whole staff flow is meant to run
    // with no database at all (see lib/db.js's `hasDb`). Answering here keeps
    // `getSql()` from throwing its "DATABASE_URL is not set" error at a
    // caller that has a perfectly good fallback for this.
    if (!hasDb()) {
      // Claiming a lead is fire-and-forget by design — nothing to record, and
      // nothing that should look like a failure.
      if (action === "claim") return res.json({ ok: true, skipped: "no database" });
      return res.status(503).json({ error: "No lead database is configured." });
    }

    const sql = getSql();

    if (action === "create_walkin") {
      const leadId = `WALKIN-${Date.now()}`;
      const createdAt = Date.now();
      await sql`
        INSERT INTO leads (lead_id, phone, name, budget, preferred_project, lead_status, previous_visits, interested_tower, family_size, loan_requirement, created_at)
        VALUES (${leadId}, '', 'Walk-in Customer', '', '', 'New', 0, '', 0, false, ${createdAt})
      `;
      return res.json({
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
      const { leadId, staffEmail, staffName } = body;
      if (!leadId || !staffEmail) return res.status(400).json({ error: "leadId, staffEmail required" });

      const rows = await sql`SELECT assigned_staff_email FROM leads WHERE lead_id = ${leadId}`;
      const previousOwner = rows[0]?.assigned_staff_email ?? null;

      await sql`UPDATE leads SET assigned_staff_email = ${staffEmail} WHERE lead_id = ${leadId}`;

      if (previousOwner && previousOwner !== staffEmail) {
        await sql`
          INSERT INTO activity_events (id, session_id, staff_email, staff_name, manager_email, lead_id, lead_name, type, label, at)
          VALUES (
            ${randomUUID()}, ${"leads-" + leadId}, ${staffEmail}, ${staffName ?? staffEmail}, NULL,
            ${leadId}, NULL, 'lead_reassigned',
            ${`Reassigned from ${previousOwner} to ${staffEmail}`}, ${Date.now()}
          )
        `;
      }
      return res.json({ ok: true, reassignedFrom: previousOwner !== staffEmail ? previousOwner : null });
    }

    if (action === "set_status") {
      const { leadId, status } = body;
      if (!leadId || !status) return res.status(400).json({ error: "leadId, status required" });
      await sql`UPDATE leads SET lead_status = ${status} WHERE lead_id = ${leadId}`;
      return res.json({ ok: true });
    }

    if (action === "delete_lead") {
      // Authorisation already checked at the top, before the database was
      // touched — see the note there.
      const { leadId } = body;
      if (!leadId) return res.status(400).json({ error: "leadId required" });

      const leadRows = await sql`SELECT name FROM leads WHERE lead_id = ${leadId}`;
      const leadName = leadRows[0]?.name ?? "";

      await sql`DELETE FROM leads WHERE lead_id = ${leadId}`;
      // Scrubs the customer's name from their activity history (the phone
      // number was never stored there — only in the now-deleted `leads` row)
      // while leaving the events themselves in place: they're staff
      // accountability records (who did what, when), not the customer's data,
      // and this route's own audit log needs the append-only guarantee to hold
      // for everyone else's history too.
      await sql`UPDATE activity_events SET lead_name = NULL WHERE lead_id = ${leadId}`;
      // The structured lead_name column isn't the only place the name landed —
      // every event's free-text `label` was generated from it too (e.g.
      // "Opened profile for Rohan Mehta"), so scrubbing lead_name alone still
      // leaves the name readable in the timeline. `replace()` on an empty
      // needle is a no-op guard for walk-ins with no real name to scrub.
      if (leadName) {
        // No LIKE filter needed — replace() is a no-op on rows where the name
        // doesn't occur, and a wildcard-based WHERE would need leadName's own
        // %/_ characters escaped to stay correct.
        await sql`
          UPDATE activity_events
          SET label = replace(label, ${leadName}, '[deleted]')
          WHERE lead_id = ${leadId}
        `;
      }
      await sql`
        INSERT INTO activity_events (id, session_id, staff_email, staff_name, manager_email, lead_id, lead_name, type, label, at)
        VALUES (${randomUUID()}, ${"leads-" + leadId}, 'admin', 'Admin', NULL, ${leadId}, NULL, 'status', 'Customer data deleted', ${Date.now()})
      `;
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: "unknown action" });
  }),
);
