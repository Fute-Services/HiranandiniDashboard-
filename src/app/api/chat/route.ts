import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { isSameOrigin } from "@/lib/csrf";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";
import { CHAT_SYSTEM_PROMPT } from "@/lib/chat-prompt";

/**
 * Streaming chat endpoint for the dashboard's AI sales assistant, via the
 * Vercel AI Gateway (OIDC on deploys, VERCEL_OIDC_TOKEN locally — no key to
 * manage). Not in middleware's public list, so only signed-in users reach
 * it; the strict project-only persona lives in src/lib/chat-prompt.ts.
 */
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }
  if (!checkRateLimit(`chat:${clientKey(req)}`, 30, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model: "anthropic/claude-sonnet-5",
    system: CHAT_SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse();
}
