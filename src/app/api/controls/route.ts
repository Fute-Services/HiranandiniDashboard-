import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSql } from "@/lib/db";
import { isSameOrigin } from "@/lib/csrf";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";

/**
 * Admin/sales-manager controls over sales staff and projects, backed by
 * Postgres (see scripts/db/schema.sql — `staff_controls`). This has to live
 * server-side rather than in localStorage: cookies (who's signed in) and
 * localStorage are both scoped to the same browser profile, so two tabs in
 * one browser can't hold two different signed-in identities at once (logging
 * in as staff in one tab silently logs in that same browser as staff
 * everywhere). A real manager and a real sales-staff member are on separate
 * devices/browsers, so the shared control state needs a channel that isn't
 * tied to a single browser's storage — this route is that channel.
 */

type Row = { kicked: boolean; blocked_projects: string[] };

export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email");
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });

  const sql = getSql();
  const rows = (await sql`
    SELECT kicked, blocked_projects FROM staff_controls WHERE email = ${email}
  `) as Row[];
  const row = rows[0];

  return NextResponse.json({
    kicked: row?.kicked ?? false,
    blockedProjects: row?.blocked_projects ?? [],
  });
}

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }
  // Per-IP only, kept loose for the same office-NAT reason as /api/login and
  // /api/activity — this is only admin/manager actions (kick, block), but
  // several managers on one office network shouldn't collide with each other.
  if (!checkRateLimit(`controls:${clientKey(req)}`, 300, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const body = await req.json();
  const { action, email, slug } = body as { action: string; email: string; slug?: string };
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });

  const sql = getSql();
  await sql`
    INSERT INTO staff_controls (email, kicked, blocked_projects)
    VALUES (${email}, false, '{}')
    ON CONFLICT (email) DO NOTHING
  `;

  if (action === "kick") {
    await sql`UPDATE staff_controls SET kicked = true WHERE email = ${email}`;
  } else if (action === "ack") {
    await sql`UPDATE staff_controls SET kicked = false WHERE email = ${email}`;
  } else if (action === "block" || action === "unblock") {
    if (!slug) return NextResponse.json({ error: "slug required" }, { status: 400 });
    if (action === "block") {
      await sql`
        UPDATE staff_controls
        SET blocked_projects = array_append(blocked_projects, ${slug})
        WHERE email = ${email} AND NOT (${slug} = ANY(blocked_projects))
      `;
    } else {
      await sql`
        UPDATE staff_controls
        SET blocked_projects = array_remove(blocked_projects, ${slug})
        WHERE email = ${email}
      `;
    }
  } else {
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
