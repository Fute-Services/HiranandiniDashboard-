import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSql, hasDb } from "@/lib/db";
import { withJsonErrors } from "@/lib/api";
import { isSameOrigin } from "@/lib/csrf";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";
import { AUTH_COOKIE } from "@/lib/auth";
import { verifySessionToken } from "@/lib/session-token";
import { USERS } from "@/lib/users";
import { DEVICE_TYPES, type DeviceType } from "@/lib/session";
import { recordDeviceUsage } from "@/lib/sperto-device-usage";

/**
 * Fires Sperto's device-usage log (src/lib/sperto-device-usage.ts) for the
 * signed-in staff member's presentation session — "IN" on start, "OUT" on
 * end (see src/lib/session.ts's setActiveSession/finalizeSession). The
 * api_key stays server-side, so the client only ever posts here, never
 * straight to Sperto.
 *
 * Always answers 200/ok even when nothing was actually sent (unconfigured,
 * or the signed-in account has no Sperto login code on file) — this is a
 * best-effort side log, and its outcome must never affect whether a
 * presentation session is allowed to start or end.
 */

async function spertoLoginFor(email: string): Promise<string | null> {
  const staticUser = USERS.find((u) => u.email === email);
  if (staticUser) return staticUser.spertoLogin ?? null;
  if (!hasDb()) return null;
  const sql = getSql();
  const rows = (await sql`SELECT sperto_login FROM users WHERE email = ${email}`) as {
    sperto_login: string | null;
  }[];
  return rows[0]?.sperto_login ?? null;
}

export const POST = withJsonErrors(async (req: NextRequest) => {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }
  if (!checkRateLimit(`device-usage:${clientKey(req)}`, 60, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const token = req.cookies.get(AUTH_COOKIE)?.value;
  const secret = process.env.SESSION_SECRET;
  const payload = token && secret ? await verifySessionToken(token, secret) : null;
  if (!payload) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await req.json();
  const { leadId, deviceType, type, pageUrl } = body as {
    leadId?: string;
    deviceType?: DeviceType | null;
    type?: "IN" | "OUT";
    pageUrl?: string;
  };

  if (!leadId || (type !== "IN" && type !== "OUT")) {
    return NextResponse.json({ error: "leadId and type (IN/OUT) required" }, { status: 400 });
  }
  if (deviceType != null && !DEVICE_TYPES.includes(deviceType)) {
    return NextResponse.json({ error: "Invalid deviceType" }, { status: 400 });
  }

  const salesManagerLogin = await spertoLoginFor(payload.email);
  if (!salesManagerLogin) {
    return NextResponse.json({ ok: true, skipped: "no sperto login on file" });
  }

  await recordDeviceUsage({
    deviceType: deviceType ?? null,
    leadId,
    salesManagerLogin,
    type,
    pageUrl: pageUrl?.trim() || req.nextUrl.origin,
  });

  return NextResponse.json({ ok: true });
});
