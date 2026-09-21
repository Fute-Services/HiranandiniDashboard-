import { Router } from "express";
import { getSql, hasDb } from "../lib/db.js";
import { withJsonErrors } from "../lib/api.js";
import { isSameOrigin } from "../lib/csrf.js";
import { checkRateLimit, clientKey } from "../lib/rate-limit.js";
import { hashPassword } from "../lib/password.js";
import { getViewer } from "../lib/viewer.js";
import { USERS } from "../lib/users.js";

/**
 * Sales manager/staff account directory + creation. Admin-created accounts
 * live in the `users` table (see scripts/db/schema.sql) — the roster in
 * src/lib/users.js stays untouched, since it's shipped client-side and a real
 * account's password must never end up there.
 */
export const usersRouter = Router();

/** Staff+manager directory for the reports dashboard — admin accounts are
 * excluded on purpose (they're not a "team" anyone is scoped to or reports
 * on), including ones created via POST below. */
async function allStaffAndManagers() {
  const fromStatic = USERS.filter((u) => u.role !== "admin").map((u) => ({
    email: u.email,
    name: u.name,
    role: u.role,
    managerEmail: u.managerEmail ?? null,
    joiningDate: u.joiningDate ?? null,
    spertoLogin: u.spertoLogin ?? null,
  }));
  // No DB configured means no admin-created accounts to add — the demo
  // roster is just the static array.
  if (!hasDb()) return fromStatic;

  const sql = getSql();
  const rows = await sql`
    SELECT email, name, role, manager_email, joining_date, sperto_login FROM users WHERE role != 'admin'
  `;
  const fromDb = rows.map((r) => ({
    email: r.email,
    name: r.name,
    role: r.role,
    managerEmail: r.manager_email,
    joiningDate: r.joining_date,
    spertoLogin: r.sperto_login,
  }));
  return [...fromStatic, ...fromDb];
}

/** Any email already in use, across both the static roster and the DB table
 * — regardless of role, since an admin account and a staff account can't
 * share an email either. */
async function emailInUse(email) {
  if (USERS.some((u) => u.email === email)) return true;
  const sql = getSql();
  const rows = await sql`SELECT 1 FROM users WHERE email = ${email}`;
  return rows.length > 0;
}

usersRouter.get(
  "/",
  withJsonErrors(async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer) return res.status(401).json({ error: "Not signed in" });

    const all = await allStaffAndManagers();
    if (viewer.role === "admin") return res.json({ users: all });
    if (viewer.role === "sales_manager") {
      const scoped = all.filter((u) => u.email === viewer.email || u.managerEmail === viewer.email);
      return res.json({ users: scoped });
    }
    return res.status(403).json({ error: "Not authorized" });
  }),
);

usersRouter.post(
  "/",
  withJsonErrors(async (req, res) => {
    if (!isSameOrigin(req)) {
      return res.status(403).json({ error: "Invalid origin" });
    }
    if (!checkRateLimit(`users:${clientKey(req)}`, 60, 60_000)) {
      return res.status(429).json({ error: "Too many requests" });
    }
    const viewer = await getViewer(req);
    if (viewer?.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }

    const body = req.body ?? {};
    const { name, email: rawEmail, password, role, managerEmail, spertoLogin: rawSpertoLogin } = body;
    const email = rawEmail?.trim().toLowerCase();
    const spertoLogin = rawSpertoLogin?.trim() || null;

    if (!name?.trim()) return res.status(400).json({ error: "Name required" });
    if (!email) return res.status(400).json({ error: "Email required" });
    if (!password || password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }
    if (role !== "sales_manager" && role !== "sales_staff" && role !== "admin") {
      return res.status(400).json({ error: "Role must be admin, sales_manager, or sales_staff" });
    }

    if (await emailInUse(email)) {
      return res.status(409).json({ error: "An account with that email already exists" });
    }

    let normalizedManagerEmail = null;
    if (role === "sales_staff") {
      if (!managerEmail) return res.status(400).json({ error: "Manager required for sales staff" });
      const existing = await allStaffAndManagers();
      const managerExists = existing.some((u) => u.role === "sales_manager" && u.email === managerEmail);
      if (!managerExists) return res.status(400).json({ error: "Selected manager was not found" });
      normalizedManagerEmail = managerEmail;
    }

    const sql = getSql();
    await sql`
      INSERT INTO users (email, password_hash, name, role, manager_email, joining_date, created_at, sperto_login)
      VALUES (${email}, ${hashPassword(password)}, ${name.trim()}, ${role}, ${normalizedManagerEmail}, ${new Date().toISOString()}, ${Date.now()}, ${spertoLogin})
    `;

    return res.json({ ok: true });
  }),
);
