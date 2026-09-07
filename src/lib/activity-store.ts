import "server-only";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { writeFile, rename } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import type { ActivityEvent } from "./activity";

/**
 * The activity log's storage when no `DATABASE_URL` is configured — which is
 * the normal case for this app, since the whole staff flow is meant to run
 * with no database and no credentials (see README, "Dummy data").
 *
 * Before this existed, `/api/activity` answered `{ ok: true }` to every POST
 * without a database and `[]` to every GET, so a full walkthrough looked
 * logged from the browser's side and was in fact dropped on the floor. This
 * keeps the same server-side, append-only shape the DB path has — there is
 * still no update or delete, so sales staff have no path to edit or erase
 * their own history — without needing Postgres.
 *
 * Server-side and not `localStorage` for the reason `lib/activity.ts` and
 * `/api/controls` already spell out: a manager and a sales-staff member are
 * on separate browsers on separate devices, so a per-browser store is
 * invisible to the person the log exists for, and is erasable by the person
 * it is about.
 */

/** Same cap the DB path applies, for the same reason: one response, and now
 * one file, can never grow unbounded as history piles up. Oldest events are
 * dropped first. */
const MAX_EVENTS = 5000;

const FILE_NAME = "activity.json";

/**
 * Where the log file lives.
 *
 * `.data/` beside the project by default, so a `npm run dev` restart doesn't
 * lose the log. On a read-only deployment filesystem (Vercel's, everywhere
 * but `/tmp`) that `mkdir` throws, and the temp directory is used instead —
 * which survives warm invocations on one instance but not a cold start.
 * That is the honest ceiling of a no-database setup, and it is why
 * `storageKind()` exists: the caller reports which one is in play rather
 * than letting a deployment quietly look more durable than it is.
 */
export type StorageKind = "file" | "temp" | "memory";

let dir: string | null = null;
let kind: StorageKind | null = null;

function resolveDir(): { dir: string; kind: StorageKind } {
  const configured = process.env.ACTIVITY_LOG_DIR?.trim();
  const candidates: { path: string; kind: StorageKind }[] = configured
    ? [{ path: configured, kind: "file" }]
    : [
        { path: join(process.cwd(), ".data"), kind: "file" },
        { path: join(tmpdir(), "hiranandani-activity"), kind: "temp" },
      ];
  for (const candidate of candidates) {
    try {
      mkdirSync(candidate.path, { recursive: true });
      return { dir: candidate.path, kind: candidate.kind };
    } catch {
      // Unwritable; fall through to the next candidate.
    }
  }
  // Nothing writable at all: the in-memory array below is still the store,
  // it just never reaches disk. The flow keeps working, as everywhere else
  // in this file — a lost log line must never break a presentation.
  return { dir: "", kind: "memory" };
}

function storageDir(): string {
  if (dir === null) {
    const resolved = resolveDir();
    dir = resolved.dir;
    kind = resolved.kind;
  }
  return dir;
}

/** Which of the three storage situations is actually in effect. Resolves the
 * directory on first call, so it reflects reality rather than intent. */
export function storageKind(): StorageKind {
  storageDir();
  return kind ?? "memory";
}

let events: ActivityEvent[] | null = null;

/**
 * Read synchronously, once, on first use. Async would mean every caller
 * awaiting a load that has already happened 99% of the time, and this runs
 * before the first request is answered rather than inside a hot path.
 */
function load(): ActivityEvent[] {
  if (events !== null) return events;
  const base = storageDir();
  if (!base) return (events = []);
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(base, FILE_NAME), "utf8"));
    // A file written by an older build, hand-edited, or truncated by a crash
    // mid-write lands here. Start clean rather than handing the dashboards
    // rows they'll destructure into undefined.
    events = Array.isArray(parsed) ? (parsed as ActivityEvent[]) : [];
  } catch {
    // Missing file on first run is the common case, not an error.
    events = [];
  }
  return events;
}

/**
 * Writes are serialized through one chain and never awaited by the request
 * handler: two events arriving together would otherwise interleave two full
 * rewrites of the same file. Written to a sibling temp file and renamed,
 * which is atomic on both platforms, so a process killed mid-write leaves
 * the previous complete log rather than a half-written one.
 */
let pending: Promise<void> = Promise.resolve();

function persist() {
  const base = storageDir();
  if (!base) return;
  const snapshot = JSON.stringify(events ?? []);
  pending = pending.then(async () => {
    const target = join(base, FILE_NAME);
    const temp = `${target}.${process.pid}.tmp`;
    try {
      await writeFile(temp, snapshot, "utf8");
      await rename(temp, target);
    } catch {
      // Best-effort, same contract as the rest of the log: a failed write
      // costs log lines, never the sales flow. The in-memory array still
      // holds everything this process has seen.
    }
  });
}

/** Appends one event. Returns it back for symmetry with the DB path, which
 * answers with the row it inserted. */
export function appendEvent(event: ActivityEvent): ActivityEvent {
  const all = load();
  all.push(event);
  if (all.length > MAX_EVENTS) all.splice(0, all.length - MAX_EVENTS);
  persist();
  return event;
}

export type StoreFilters = {
  managerEmail?: string | null;
  staffEmail?: string | null;
  leadId?: string | null;
  /** Substring, matched case-insensitively against the label and the lead
   * name — the same two columns the SQL path's `project` filter searches. */
  project?: string | null;
  from?: number | null;
  to?: number | null;
};

/**
 * Same result shape and ordering the SQL query produces: filtered, capped to
 * the most recent MAX_EVENTS, then handed back oldest-first, which is the
 * order the timeline components render in.
 */
export function listEvents(filters: StoreFilters = {}): ActivityEvent[] {
  const { managerEmail, staffEmail, leadId, from, to } = filters;
  const project = filters.project?.toLowerCase();
  const matched = load().filter((e) => {
    if (managerEmail && e.managerEmail !== managerEmail) return false;
    if (staffEmail && e.staffEmail !== staffEmail) return false;
    if (leadId && e.leadId !== leadId) return false;
    if (from !== null && from !== undefined && e.at < from) return false;
    if (to !== null && to !== undefined && e.at > to) return false;
    if (project) {
      const haystack = `${e.label} ${e.leadName ?? ""}`.toLowerCase();
      if (!haystack.includes(project)) return false;
    }
    return true;
  });
  // Ascending by time, keeping the most recent MAX_EVENTS when over the cap.
  matched.sort((a, b) => a.at - b.at);
  return matched.length > MAX_EVENTS ? matched.slice(matched.length - MAX_EVENTS) : matched;
}

/** How many events are held right now — used by the storage-status line the
 * route reports, so "is anything actually being recorded?" has an answer
 * that doesn't require reading the file by hand. */
export function eventCount(): number {
  return load().length;
}
