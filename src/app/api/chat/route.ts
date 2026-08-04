import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withJsonErrors } from "@/lib/api";
import { isSameOrigin } from "@/lib/csrf";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";
import { AUTH_COOKIE } from "@/lib/auth";
import { verifySessionToken } from "@/lib/session-token";
import { portfolioGroups } from "@/data/properties";

/**
 * Groq-backed assistant for the dashboard's chat panel (see
 * SessionReports.tsx's ChatPanel). Groq's API is OpenAI-compatible, so this
 * is a plain fetch, no extra SDK dependency needed.
 */

const GROQ_MODEL = "llama-3.3-70b-versatile";
const MAX_HISTORY = 12;

/** Built once at module load from the actual portfolio data (same source
 * the property carousel/showcase renders from), so the assistant answers
 * from the real project list instead of a generic placeholder. */
const SYSTEM_PROMPT = (() => {
  const lines = portfolioGroups.flatMap((group) =>
    group.projects.map((p) => {
      const amenities = p.amenities?.length ? ` Amenities: ${p.amenities.join(", ")}.` : "";
      return `- ${p.name} (${group.name}, ${p.location}).${amenities}`;
    }),
  );
  return [
    "You are the assistant embedded in a real estate sales dashboard for Fute Services.",
    "You help sales staff, managers, and admins with questions about the property portfolio and how to use the dashboard.",
    "Keep answers short and direct.",
    "",
    "Portfolio:",
    ...lines,
  ].join("\n");
})();

type ChatMessage = { role: "user" | "assistant"; content: string };

async function requireViewer(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(AUTH_COOKIE)?.value;
  const secret = process.env.SESSION_SECRET;
  if (!token || !secret) return false;
  const payload = await verifySessionToken(token, secret);
  return payload !== null;
}

export const POST = withJsonErrors(async (req: NextRequest) => {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }
  if (!checkRateLimit(`chat:${clientKey(req)}`, 30, 60_000)) {
    return NextResponse.json({ error: "Too many requests, slow down a little." }, { status: 429 });
  }
  if (!(await requireViewer(req))) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GROQ_API_KEY is not set. Add it to .env.local and restart the dev server." },
      { status: 500 },
    );
  }

  const body = await req.json();
  const { messages } = body as { messages?: ChatMessage[] };
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "messages required" }, { status: 400 });
  }

  const trimmed = messages.slice(-MAX_HISTORY);

  const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...trimmed],
    }),
  });

  if (!groqRes.ok) {
    const detail = await groqRes.text().catch(() => "");
    console.error("[api/chat] Groq error", groqRes.status, detail);
    return NextResponse.json({ error: "The assistant is unavailable right now." }, { status: 502 });
  }

  const data = (await groqRes.json()) as { choices?: { message?: { content?: string } }[] };
  const reply = data.choices?.[0]?.message?.content?.trim();
  if (!reply) {
    return NextResponse.json({ error: "The assistant returned an empty response." }, { status: 502 });
  }

  return NextResponse.json({ reply });
});
