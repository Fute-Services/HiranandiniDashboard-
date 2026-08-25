import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSql, hasDb } from "@/lib/db";
import { withJsonErrors } from "@/lib/api";
import { isSameOrigin } from "@/lib/csrf";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";
import { AUTH_COOKIE } from "@/lib/auth";
import { verifySessionToken } from "@/lib/session-token";
import { hashPassword } from "@/lib/password";
import { USERS, type Role } from "@/lib/users";

/**
 * Sales manager/staff account directory + creation. Admin-created accounts
 * live in the `users` table (see scripts/db/schema.sql) — the hardcoded
 * `USERS` array in src/lib/users.ts stays untouched, since it's shipped
 * client-side (login page's demo buttons) and a real account's password
 * must never end up there.
 */

type Viewer = { email: string; role: Role };

async function getViewer(req: NextRequest): Promise<Viewer | null> {
  const token = req.cookies.get(AUTH_COOKIE)?.value;
  const secret = process.env.SESSION_SECRET;
  if (!token || !secret) return null;
  const payload = await verifySessionToken(token, secret);
  if (!payload) return null;
  return { email: payload.email, role: payload.role };
}

type StaffUser = {
  email: string;
  name: string;
  role: "sales_manager" | "sales_staff";
  managerEmail: string | null;
  joiningDate: string | null;
  spertoLogin: string | null;
};

/** Staff+manager directory for the reports dashboard — admin accounts are
 * excluded on purpose (they're not a "team" anyone is scoped to or reports
 * on), including ones created via POST below. */
async function allStaffAndManagers(): Promise<StaffUser[]> {
  const fromStatic: StaffUser[] = USERS.filter((u) => u.role !== "admin").map((u) => ({
    email: u.email,
    name: u.name,
    role: u.role as "sales_manager" | "sales_staff",
    managerEmail: u.managerEmail ?? null,
    joiningDate: u.joiningDate ?? null,
    spertoLogin: u.spertoLogin ?? null,
  }));
  // No DB configured means no admin-created accounts to add — the demo
  // roster is just the static array below.
  if (!hasDb()) return fromStatic;

  const sql = getSql();
  const rows = (await sql`
    SELECT email, name, role, manager_email, joining_date, sperto_login FROM users WHERE role != 'admin'
  `) as {
    email: string;
    name: string;
    role: string;
    manager_email: string | null;
    joining_date: string | null;
    sperto_login: string | null;
  }[];
  const fromDb: StaffUser[] = rows.map((r) => ({
    email: r.email,
    name: r.name,
    role: r.role as "sales_manager" | "sales_staff",
    managerEmail: r.manager_email,
    joiningDate: r.joining_date,
    spertoLogin: r.sperto_login,
  }));
  return [...fromStatic, ...fromDb];
}

/** Any email already in use, across both the static array and the DB table
 * — regardless of role, since an admin account and a staff account can't
 * share an email either. */
async function emailInUse(email: string): Promise<boolean> {
  if (USERS.some((u) => u.email === email)) return true;
  const sql = getSql();
  const rows = (await sql`SELECT 1 FROM users WHERE email = ${email}`) as unknown[];
  return rows.length > 0;
}

export const GET = withJsonErrors(async (req: NextRequest) => {
  const viewer = await getViewer(req);
  if (!viewer) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const all = await allStaffAndManagers();
  if (viewer.role === "admin") return NextResponse.json({ users: all });
  if (viewer.role === "sales_manager") {
    const scoped = all.filter((u) => u.email === viewer.email || u.managerEmail === viewer.email);
    return NextResponse.json({ users: scoped });
  }
  return NextResponse.json({ error: "Not authorized" }, { status: 403 });
});

export const POST = withJsonErrors(async (req: NextRequest) => {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }
  if (!checkRateLimit(`users:${clientKey(req)}`, 60, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  const viewer = await getViewer(req);
  if (viewer?.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const body = await req.json();
  const { name, email: rawEmail, password, role, managerEmail, spertoLogin: rawSpertoLogin } = body as {
    name?: string;
    email?: string;
    password?: string;
    role?: string;
    managerEmail?: string;
    spertoLogin?: string;
  };
  const email = rawEmail?.trim().toLowerCase();
  const spertoLogin = rawSpertoLogin?.trim() || null;

  if (!name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });
  if (!email) return NextResponse.json({ error: "Email required" }, { status: 400 });
  if (!password || password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }
  if (role !== "sales_manager" && role !== "sales_staff" && role !== "admin") {
    return NextResponse.json({ error: "Role must be admin, sales_manager, or sales_staff" }, { status: 400 });
  }

  if (await emailInUse(email)) {
    return NextResponse.json({ error: "An account with that email already exists" }, { status: 409 });
  }

  let normalizedManagerEmail: string | null = null;
  if (role === "sales_staff") {
    if (!managerEmail) return NextResponse.json({ error: "Manager required for sales staff" }, { status: 400 });
    const existing = await allStaffAndManagers();
    const managerExists = existing.some((u) => u.role === "sales_manager" && u.email === managerEmail);
    if (!managerExists) return NextResponse.json({ error: "Selected manager was not found" }, { status: 400 });
    normalizedManagerEmail = managerEmail;
  }

  const sql = getSql();
  await sql`
    INSERT INTO users (email, password_hash, name, role, manager_email, joining_date, created_at, sperto_login)
    VALUES (${email}, ${hashPassword(password)}, ${name.trim()}, ${role}, ${normalizedManagerEmail}, ${new Date().toISOString()}, ${Date.now()}, ${spertoLogin})
  `;

  return NextResponse.json({ ok: true });
});
