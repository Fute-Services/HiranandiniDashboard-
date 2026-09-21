import { Router } from "express";
import { put } from "@vercel/blob";
import { getSql } from "../lib/db.js";
import { withJsonErrors } from "../lib/api.js";

/**
 * Daily snapshot of the activity log to Blob storage — automates what was
 * previously a manual CSV export. Verified by CRON_SECRET rather than the
 * app's own session cookies, since this never runs in a signed-in browser
 * context — which is also why it sits outside every other gate here.
 *
 * Under Next.js on Vercel this was scheduled by `vercel.json` and the secret
 * was injected automatically. Off that platform, whatever runs the schedule
 * (a system cron, a CI job, an uptime pinger) has to send the header itself:
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/backup
 *
 * With no CRON_SECRET set, every call is refused — an unset secret must read
 * as "locked", never as "no check needed".
 */
export const cronRouter = Router();

cronRouter.get(
  "/backup",
  withJsonErrors(async (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.get("authorization") !== `Bearer ${secret}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const sql = getSql();
    const rows = await sql`SELECT * FROM activity_events ORDER BY at ASC`;

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

    return res.json({ ok: true, rows: rows.length, url: blob.url });
  }),
);
