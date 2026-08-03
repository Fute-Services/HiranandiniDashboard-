import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSql } from "@/lib/db";
import { withJsonErrors } from "@/lib/api";
import { isSameOrigin } from "@/lib/csrf";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";
import { AUTH_COOKIE } from "@/lib/auth";
import { verifySessionToken } from "@/lib/session-token";

/**
 * Manually admin-entered unit-availability count per project (see
 * scripts/db/schema.sql's `property_inventory`). Absent/NULL means "not set" —
 * callers must not fabricate a number, only show one the admin actually
 * entered (see PropertyShowcase's urgency note).
 */

async function requireAdmin(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(AUTH_COOKIE)?.value;
  const secret = process.env.SESSION_SECRET;
  if (!token || !secret) return false;
  const payload = await verifySessionToken(token, secret);
  return payload?.role === "admin";
}

export const GET = withJsonErrors(async () => {
  const sql = getSql();
  const rows = (await sql`SELECT slug, units_left FROM property_inventory`) as {
    slug: string;
    units_left: number | null;
  }[];
  const bySlug: Record<string, number | null> = {};
  for (const r of rows) bySlug[r.slug] = r.units_left;
  return NextResponse.json({ inventory: bySlug });
});

export const POST = withJsonErrors(async (req: NextRequest) => {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }
  if (!checkRateLimit(`inventory:${clientKey(req)}`, 300, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const body = await req.json();
  const { slug, unitsLeft } = body as { slug: string; unitsLeft: number | null };
  if (!slug) return NextResponse.json({ error: "slug required" }, { status: 400 });
  if (unitsLeft !== null && (!Number.isInteger(unitsLeft) || unitsLeft < 0)) {
    return NextResponse.json({ error: "unitsLeft must be a non-negative integer or null" }, { status: 400 });
  }

  const sql = getSql();
  await sql`
    INSERT INTO property_inventory (slug, units_left, updated_at)
    VALUES (${slug}, ${unitsLeft}, ${Date.now()})
    ON CONFLICT (slug) DO UPDATE SET units_left = ${unitsLeft}, updated_at = ${Date.now()}
  `;
  return NextResponse.json({ ok: true });
});
