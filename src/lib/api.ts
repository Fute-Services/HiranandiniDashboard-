import { NextResponse } from "next/server";

/**
 * Wraps a route handler so an unexpected throw still answers with JSON. Next
 * turns an uncaught error into a 500 with no body at all, which every client
 * here then fails to parse — one broken query becomes two errors, and the
 * second one (a JSON parse failure in the browser) hides the first. The real
 * message is logged server-side, and echoed to the client only in
 * development; in production it stays internal.
 */
export function withJsonErrors<A extends unknown[]>(
  handler: (...args: A) => Promise<NextResponse>,
): (...args: A) => Promise<NextResponse> {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[api]", detail);
      return NextResponse.json(
        {
          error:
            process.env.NODE_ENV === "production"
              ? "Something went wrong on our end. Please try again."
              : `Server error: ${detail}`,
        },
        { status: 500 },
      );
    }
  };
}
