import { Router } from "express";
import { addUser, findUserByEmail as findStoredUser, listUsers } from "../lib/store.js";
import { withJsonErrors } from "../lib/api.js";
import { isSameOrigin } from "../lib/csrf.js";
import { checkRateLimit, clientKey } from "../lib/rate-limit.js";
import { hashPassword } from "../lib/password.js";
import { getViewer } from "../lib/viewer.js";
import { USERS } from "../lib/users.js";

/**
 * Sales manager/staff account directory + creation. Admin-created accounts
 * are held in the API process's memory (see server/lib/store.js); the roster
 * in src/lib/users.js stays untouched, since it's shipped client-side and a
 * real account's password hash must never end up there.
 *
 * The memory store means accounts added here last as long as the process
 * does. The demo roster always survives, so the sales flow is never left
 * without accounts to sign in with — only the admin's own additions need
 * re-entering after a restart.
 */
export const usersRouter = Router();

/** Staff+manager directory for the reports dashboard — admin accounts are
 * excluded on purpose (they're not a "team" anyone is scoped to or reports
 * on), including ones created via POST below. */
function allStaffAndManagers() {
  const fromStatic = USERS.filter((u) => u.role !== "admin").map((u) => ({
    email: u.email,
    name: u.name,
    role: u.role,
    managerEmail: u.managerEmail ?? null,
    joiningDate: u.joiningDate ?? null,
    spertoLogin: u.spertoLogin ?? null,
  }));
  const fromStore = listUsers()
    .filter((u) => u.role !== "admin")
    .map((u) => ({
      email: u.email,
      name: u.name,
      role: u.role,
      managerEmail: u.managerEmail ?? null,
      joiningDate: u.joiningDate ?? null,
      spertoLogin: u.spertoLogin ?? null,
    }));
  return [...fromStatic, ...fromStore];
}

/** Any email already in use, across both the static roster and the stored
 * accounts — regardless of role, since an admin account and a staff account
 * can't share an email either. */
function emailInUse(email) {
  return USERS.some((u) => u.email === email) || Boolean(findStoredUser(email));
}

usersRouter.get(
  "/",
  withJsonErrors(async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer) return res.status(401).json({ error: "Not signed in" });
    // Refused before the directory is assembled. With this check below the
    // lookup — as it was — a sales staff member asking for the directory got
    // whatever came back, which in production was a 500 over a missing
    // column: the wrong status, and a story about our plumbing rather than
    // about their access.
    if (viewer.role !== "admin" && viewer.role !== "sales_manager") {
      return res.status(403).json({ error: "Not authorized" });
    }

    const all = allStaffAndManagers();
    if (viewer.role === "admin") return res.json({ users: all });
    const scoped = all.filter((u) => u.email === viewer.email || u.managerEmail === viewer.email);
    return res.json({ users: scoped });
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

    if (emailInUse(email)) {
      return res.status(409).json({ error: "An account with that email already exists" });
    }

    let normalizedManagerEmail = null;
    if (role === "sales_staff") {
      if (!managerEmail) return res.status(400).json({ error: "Manager required for sales staff" });
      const managerExists = allStaffAndManagers().some(
        (u) => u.role === "sales_manager" && u.email === managerEmail,
      );
      if (!managerExists) return res.status(400).json({ error: "Selected manager was not found" });
      normalizedManagerEmail = managerEmail;
    }

    addUser({
      email,
      passwordHash: hashPassword(password),
      name: name.trim(),
      role,
      managerEmail: normalizedManagerEmail,
      joiningDate: new Date().toISOString(),
      createdAt: Date.now(),
      spertoLogin,
    });

    return res.json({ ok: true });
  }),
);
