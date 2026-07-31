import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { put } from "@vercel/blob";
import { getSql } from "@/lib/db";

/**
 * Daily snapshot of the activity log to Blob storage (see vercel.json for
 * the schedule) — automates what was previously a manual CSV export.
 * Verified by CRON_SECRET (set by Vercel automatically on every cron
 * invocation), not the app's own session cookies, since this never runs in
 * a signed-in browser context — that's also why it's exempted from
 * middleware.ts's login gate.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getSql();
  const rows = (await sql`SELECT * FROM activity_events ORDER BY at ASC`) as Record<string, unknown>[];

  const header = Object.keys(rows[0] ?? { id: "", session_id: "" });
  const csvLines = [
    header.join(","),
    ...rows.map((r) => header.map((h) => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(",")),
  ];
  const csv = csvLines.join("\n");

  // Private, not public — this is customer/staff activity data, and the
  // Blob store is provisioned private for exactly that reason.
  const date = new Date().toISOString().slice(0, 10);
  const blob = await put(`backups/activity-${date}.csv`, csv, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "text/csv",
  });

  return NextResponse.json({ ok: true, rows: rows.length, url: blob.url });
}
