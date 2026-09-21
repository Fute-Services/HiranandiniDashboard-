import { AUTH_COOKIE } from "./auth.js";
import { verifySessionToken } from "./session-token.js";

/**
 * "Who is making this request", read from the signed session cookie.
 *
 * This was the fourth copy of these eight lines — /api/users, /api/inventory
 * and /api/leads each grew their own — so anything new takes it from here
 * instead of adding a fifth. Never trust the plain `futeservices_role` cookie
 * for this: it is client-writable and exists only so the UI can render a name.
 *
 * A viewer is `{ email, role, name, deviceId? }`. `deviceId` is which
 * registered device this session was started on, for device-mode
 * (passwordless) logins, and is absent for password logins. It is read from
 * the signed token rather than from a request body — it is the only device
 * claim in the system that is signed, and everything server-side that needs
 * to know which screen a request came from must read it from here.
 */
export async function getViewer(req) {
  const token = req.cookies?.[AUTH_COOKIE];
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
 * Returns the viewer, or null having already answered. Callers do:
 *
 *   const viewer = await requireAdmin(req, res);
 *   if (!viewer) return;
 *
 * which keeps the happy path unindented and puts the 401/403 in one place
 * rather than in every route that needs one.
 */
export async function requireAdmin(req, res) {
  const viewer = await getViewer(req);
  if (!viewer) {
    res.status(401).json({ error: "Not signed in" });
    return null;
  }
  if (viewer.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return null;
  }
  return viewer;
}

export async function requireSession(req, res) {
  const viewer = await getViewer(req);
  if (!viewer) {
    res.status(401).json({ error: "Not signed in" });
    return null;
  }
  return viewer;
}
