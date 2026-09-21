import { Router } from "express";
import { getSql, hasDb } from "../lib/db.js";
import { withJsonErrors } from "../lib/api.js";
import { isSameOrigin } from "../lib/csrf.js";
import { checkRateLimit, clientKey } from "../lib/rate-limit.js";
import { requireAdmin } from "../lib/viewer.js";

/**
 * Manually admin-entered unit-availability count per project (see
 * scripts/db/schema.sql's `property_inventory`). Absent/NULL means "not set" —
 * callers must not fabricate a number, only show one the admin actually
 * entered (see PropertyShowcase's urgency note).
 */
export const inventoryRouter = Router();

inventoryRouter.get(
  "/",
  withJsonErrors(async (req, res) => {
    // No fabricated numbers either way — "not configured" and "configured but
    // nothing entered yet" both mean the urgency note just doesn't show.
    if (!hasDb()) return res.json({ inventory: {} });

    const sql = getSql();
    const rows = await sql`SELECT slug, units_left FROM property_inventory`;
    const bySlug = {};
    for (const r of rows) bySlug[r.slug] = r.units_left;
    return res.json({ inventory: bySlug });
  }),
);

inventoryRouter.post(
  "/",
  withJsonErrors(async (req, res) => {
    if (!isSameOrigin(req)) {
      return res.status(403).json({ error: "Invalid origin" });
    }
    if (!checkRateLimit(`inventory:${clientKey(req)}`, 300, 60_000)) {
      return res.status(429).json({ error: "Too many requests" });
    }
    if (!(await requireAdmin(req, res))) return;

    const { slug, unitsLeft } = req.body ?? {};
    if (!slug) return res.status(400).json({ error: "slug required" });
    if (unitsLeft !== null && (!Number.isInteger(unitsLeft) || unitsLeft < 0)) {
      return res.status(400).json({ error: "unitsLeft must be a non-negative integer or null" });
    }

    const sql = getSql();
    await sql`
      INSERT INTO property_inventory (slug, units_left, updated_at)
      VALUES (${slug}, ${unitsLeft}, ${Date.now()})
      ON CONFLICT (slug) DO UPDATE SET units_left = ${unitsLeft}, updated_at = ${Date.now()}
    `;
    return res.json({ ok: true });
  }),
);
