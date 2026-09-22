import { Router } from "express";
import { getInventory, setInventory } from "../lib/store.js";
import { withJsonErrors } from "../lib/api.js";
import { isSameOrigin } from "../lib/csrf.js";
import { checkRateLimit, clientKey } from "../lib/rate-limit.js";
import { requireAdmin } from "../lib/viewer.js";

/**
 * Manually admin-entered unit-availability count per project, held in the
 * API process's memory (see server/lib/store.js).
 *
 * Absent means "not set" — callers must not fabricate a number, only show
 * one the admin actually entered (see PropertyShowcase's urgency note). That
 * rule is what makes memory an acceptable store here: an empty one after a
 * restart reads as "nothing entered yet", which is true, rather than as a
 * wrong number.
 */
export const inventoryRouter = Router();

inventoryRouter.get(
  "/",
  withJsonErrors(async (req, res) => {
    return res.json({ inventory: getInventory() });
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

    setInventory(slug, unitsLeft);
    return res.json({ ok: true });
  }),
);
