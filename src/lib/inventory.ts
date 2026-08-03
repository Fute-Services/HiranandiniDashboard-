/**
 * Client for `/api/inventory` — manually admin-entered unit-availability
 * counts per project, shown to customers as an urgency note. Absent means
 * "not set"; never fabricate a number when this comes back empty.
 */
import { fetchWithTimeout, readJsonSafe } from "./http";

/** slug -> units left, or null if not set for that slug. Missing keys mean
 * the same thing as null (never fetched/set). */
export async function getInventory(): Promise<Record<string, number | null>> {
  try {
    const res = await fetchWithTimeout("/api/inventory");
    if (!res.ok) return {};
    const data = await readJsonSafe<{ inventory: Record<string, number | null> }>(res);
    return data?.inventory ?? {};
  } catch {
    return {};
  }
}

/** Admin-only: sets (or clears, with `null`) a project's units-left count. */
export async function setUnitsLeft(slug: string, unitsLeft: number | null): Promise<boolean> {
  try {
    const res = await fetchWithTimeout("/api/inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, unitsLeft }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
