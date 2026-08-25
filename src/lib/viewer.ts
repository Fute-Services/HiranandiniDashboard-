import "server-only";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { AUTH_COOKIE } from "./auth";
import { verifySessionToken } from "./session-token";
import type { Role } from "./users";

/**
 * "Who is making this request", read from the signed session cookie.
 *
 * This is the fourth copy of these eight lines — /api/users, /api/inventory
 * and /api/leads each grew their own — so anything new takes it from here
 * instead of adding a fifth. Never trust the plain `futeservices_role` cookie
 * for this: it is client-writable and exists only so the UI can render a name.
 */

export type Viewer = {
  email: string;
  role: Role;
  name: string;
  /** Which registered device this session was started on, for device-mode
   *  (passwordless) logins. Absent for password logins. Read from the signed
   *  token rather than from a request body — it is the only device claim in
   *  the system that is signed, and everything server-side that needs to know
   *  which screen a request came from must read it from here. */
  deviceId?: string;
};

export async function getViewer(req: NextRequest): Promise<Viewer | null> {
  const token = req.cookies.get(AUTH_COOKIE)?.value;
  const secret = process.env.SESSION_SECRET;
  if (!token || !secret) return null;
  const payload = await verifySessionToken(token, secret);
  if (!payload) return null;
  return {
    email: payload.email,
    role: payload.role,
    name: payload.name,
    deviceId: payload.deviceId,
  };
}

/**
 * Returns the viewer, or the response to send instead. Callers do:
 *
 *   const viewer = await requireAdmin(req);
 *   if (viewer instanceof NextResponse) return viewer;
 *
 * which keeps the happy path unindented and makes forgetting the check a type
 * error rather than a silently open endpoint.
 */
export async function requireAdmin(req: NextRequest): Promise<Viewer | NextResponse> {
  const viewer = await getViewer(req);
  if (!viewer) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (viewer.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  return viewer;
}

export async function requireSession(req: NextRequest): Promise<Viewer | NextResponse> {
  const viewer = await getViewer(req);
  if (!viewer) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return viewer;
}
