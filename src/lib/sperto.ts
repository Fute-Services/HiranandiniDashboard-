import "server-only";
import { fetchWithTimeout } from "./http";

/**
 * The only module that talks to Sperto (the client's CRM), and it asks them
 * one question two ways: **is this a real staff account?** — by email
 * (`spertoEmailExists`) or by Sales ID (`spertoSalesIdExists`).
 *
 * That is the whole integration. `/api/login` calls one or the other before
 * issuing a session, so the staff account list lives in Sperto rather than in
 * our database — nobody has to pre-create accounts here.
 *
 * `server-only` is not decoration: CORS on their side is wide open, so an
 * api_key that reached the browser would be usable by anyone who opened
 * devtools on a showroom tablet. Importing this from a client component is a
 * build error.
 *
 * Three quirks of their server, all verified against the live host, are why
 * this is 100 lines and not 10:
 *
 * 1. Raw JSON body only. Form-encoded bodies and query params are *ignored*,
 *    not rejected — which reads as "the request worked and did nothing".
 * 2. Errors come back HTTP 200, so `res.ok` is true for every failure. Branch
 *    on `body.status`, never on the transport status.
 * 3. The response is labelled `text/html` even though it is JSON, and
 *    `res.json()` is a coin flip across runtimes on that. `res.text()` then
 *    `JSON.parse` is not.
 */

export type SpertoCheck =
  /** Sperto knows this email. `name` is whatever they returned, if anything. */
  | { ok: true; name: string | null }
  /** Sperto answered, and the answer was no. This is the only outcome that
   *  should ever block a login — everything else is our problem, not the
   *  staff member's. */
  | { ok: false; reason: "not_found"; message: string }
  /** Sperto is unset, unreachable, slow or talking nonsense. Kept distinct
   *  from `not_found` so the login route can decide what to do about an
   *  outage without mistaking it for a rejected email. */
  | { ok: false; reason: "unavailable"; message: string };

const DEFAULT_TIMEOUT_MS = 8_000;

type SpertoConfig = { baseUrl: string; apiKey: string; timeoutMs: number };

/** Read from env per call rather than cached, so changing a Vercel env var
 *  takes effect on the next invocation instead of the next cold start. */
function config(): SpertoConfig | null {
  const baseUrl = process.env.SPERTO_BASE_URL?.trim().replace(/\/+$/, "");
  const apiKey = process.env.SPERTO_API_KEY?.trim();
  if (!baseUrl || !apiKey) return null;
  const timeout = Number(process.env.SPERTO_TIMEOUT_MS);
  return {
    baseUrl,
    apiKey,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
  };
}

/** False on a local/demo instance with no Sperto credentials, which is what
 *  lets `/api/login` fall back to the built-in account list instead of
 *  locking everyone out. */
export function isSpertoConfigured(): boolean {
  return config() !== null;
}

/** Their error bodies echo the request, api_key included, and this message can
 *  end up in a log. Strip it. */
function redact(text: string, apiKey: string): string {
  return apiKey ? text.split(apiKey).join("***") : text;
}

const FAILURE_TOKENS = new Set(["0", "false", "error", "fail", "failure", "no"]);

/** Pull a display name out of a body whose success shape nobody has
 *  documented. Returns null rather than guessing — the caller only needs
 *  "did this email resolve". */
function extractName(body: Record<string, unknown>): string | null {
  const pick = (record: Record<string, unknown>): string | null => {
    for (const key of ["name", "customer_name", "full_name"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return null;
  };
  const top = pick(body);
  if (top) return top;
  const data = body.data;
  if (typeof data === "string" && data.trim()) return data.trim();
  if (Array.isArray(data) && typeof data[0] === "object" && data[0]) {
    return pick(data[0] as Record<string, unknown>);
  }
  if (typeof data === "object" && data) return pick(data as Record<string, unknown>);
  return null;
}

/**
 * Asks Sperto whether `id` — an email or a Sales ID, distinguished by
 * `type` — is a staff account they know. Shared by spertoEmailExists and
 * spertoSalesIdExists below; never throws, since a login form has to be able
 * to show every outcome and a network blip must not surface as a crashed
 * route.
 */
async function spertoLookup(id: string, type: string): Promise<SpertoCheck> {
  const cfg = config();
  if (!cfg) return { ok: false, reason: "unavailable", message: "Sperto is not configured" };

  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${cfg.baseUrl}/api_get_details_of_customer.php`,
      {
        method: "POST",
        // Mandatory. A form-encoded body is silently ignored by their server,
        // which looks exactly like a request that worked and did nothing.
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ api_key: cfg.apiKey, id, type }),
        cache: "no-store",
      },
      cfg.timeoutMs,
    );
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      reason: "unavailable",
      message: aborted ? "Sperto did not respond in time" : "Could not reach Sperto",
    };
  }

  // They answer 200 even for rejections, so a non-200 means their server is
  // broken rather than that our request was refused.
  if (!res.ok) {
    return { ok: false, reason: "unavailable", message: `Sperto returned HTTP ${res.status}` };
  }

  let body: Record<string, unknown>;
  try {
    // res.text() rather than res.json(): the body is labelled text/html.
    const raw = redact(await res.text(), cfg.apiKey);
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { ok: false, reason: "unavailable", message: "Sperto returned an unexpected body" };
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return { ok: false, reason: "unavailable", message: "Sperto returned a body that is not JSON" };
  }

  const status = body.status;
  const failed =
    status === false ||
    status === 0 ||
    (typeof status === "string" && FAILURE_TOKENS.has(status.trim().toLowerCase()));

  if (failed) {
    const message = ["message", "msg", "error"]
      .map((k) => body[k])
      .find((v): v is string => typeof v === "string" && v.trim().length > 0);
    // A rejection that blames the api_key is our misconfiguration, not an
    // unknown identity — saying "that isn't recognised" at somebody whose
    // email or Sales ID was fine is how a five-minute fix becomes an afternoon.
    if (message && /api[_ -]?key|unauthori[sz]|authentication|forbidden/i.test(message)) {
      return { ok: false, reason: "unavailable", message: "Sperto rejected the api_key" };
    }
    return { ok: false, reason: "not_found", message: message ?? "Sperto does not recognise that" };
  }

  return { ok: true, name: extractName(body) };
}

/** Asks Sperto whether `email` is a staff account they know. */
export async function spertoEmailExists(email: string): Promise<SpertoCheck> {
  return spertoLookup(email, "sales_manager_email");
}

/**
 * Asks Sperto whether `salesId` (e.g. "PDPL0349" — the same code used as
 * sales_manager_login on the device-usage calls, src/lib/sperto-device-usage.ts)
 * is a staff account they know. Used by /api/login's Sales ID sign-in so
 * that door gets the same live check the email one does, rather than
 * trusting only our own `users.sperto_login` column.
 *
 * `type: "sales_manager_login"` is inferred from their own naming (the field
 * they call `sales_manager_login` on the device-usage endpoint, mirroring
 * `type: "sales_manager_email"` above) — not yet confirmed against the live
 * host the way spertoEmailExists's three quirks are. Revisit if Sperto's
 * actual error wording here doesn't match the `not_found`/`unavailable`
 * split those quirks assume. */
export async function spertoSalesIdExists(salesId: string): Promise<SpertoCheck> {
  return spertoLookup(salesId, "sales_manager_login");
}
