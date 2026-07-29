import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Admin/sales-manager controls over sales staff and projects, backed by an
 * in-memory store on the dev server (persists for the process lifetime, not
 * across restarts — there's no DB yet). This has to live server-side rather
 * than in localStorage: cookies (who's signed in) and localStorage are both
 * scoped to the same browser profile, so two tabs in one browser can't hold
 * two different signed-in identities at once (logging in as staff in one
 * tab silently logs in that same browser as staff everywhere). A real
 * manager and a real sales-staff member are on separate devices/browsers,
 * so the shared control state needs a channel that isn't tied to a single
 * browser's storage — this route is that channel.
 */
declare global {
  // eslint-disable-next-line no-var
  var __hiranandaniControls:
    | { kicked: Set<string>; blocked: Map<string, Set<string>> }
    | undefined;
}

const store =
  globalThis.__hiranandaniControls ??
  (globalThis.__hiranandaniControls = { kicked: new Set(), blocked: new Map() });

export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email");
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });
  return NextResponse.json({
    kicked: store.kicked.has(email),
    blockedProjects: [...(store.blocked.get(email) ?? [])],
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action, email, slug } = body as { action: string; email: string; slug?: string };
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });

  if (action === "kick") store.kicked.add(email);
  else if (action === "ack") store.kicked.delete(email);
  else if (action === "block" || action === "unblock") {
    if (!slug) return NextResponse.json({ error: "slug required" }, { status: 400 });
    const set = store.blocked.get(email) ?? new Set<string>();
    if (action === "block") set.add(slug);
    else set.delete(slug);
    store.blocked.set(email, set);
  } else {
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
