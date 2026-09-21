/**
 * The only module that talks to Sperto (the client's CRM), and it asks them
 * one question two ways: **is this a real staff account?** — by email
 * (`spertoEmailExists`) or by Sales ID (`spertoSalesIdExists`).
 *
 * That is the whole integration. The login route calls one or the other
 * before issuing a session, so the staff account list lives in Sperto rather
 * than in our database — nobody has to pre-create accounts here.
 *
 * Under Next.js this carried a `server-only` import, because CORS on their
 * side is wide open and an api_key that reached the browser would be usable
 * by anyone who opened devtools on a showroom tablet. That marker is gone
 * because it is no longer needed: this file lives under `server/`, which is
 * never part of the browser bundle. The reason it must not reach the client
 * is unchanged — keep it here.
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
 *
 * A check resolves to one of three things:
 * - `{ ok: true, name }` — Sperto knows this identity; `name` is whatever
 *   they returned, if anything.
 * - `{ ok: false, reason: "not_found", message }` — Sperto answered, and the
 *   answer was no. This is the only outcome that should ever block a login;
 *   everything else is our problem, not the staff member's.
 * - `{ ok: false, reason: "unavailable", message }` — Sperto is unset,
 *   unreachable, slow or talking nonsense. Kept distinct from `not_found` so
 *   the login route can decide what to do about an outage without mistaking
 *   it for a rejected email.
 */
import { fetchWithTimeout } from "./http.js";
import { blamesApiKey, readSpertoBody } from "./sperto-response.js";

const DEFAULT_TIMEOUT_MS = 8_000;

/** Read from env per call rather than cached, so changing an env var takes
 *  effect on the next invocation instead of the next restart. */
function config() {
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
 *  lets the login route fall back to the built-in account list instead of
 *  locking everyone out. */
export function isSpertoConfigured() {
  return config() !== null;
}

/** Pull a display name out of a body whose success shape nobody has
 *  documented. Returns null rather than guessing — the caller only needs
 *  "did this email resolve". */
function extractName(body) {
  const pick = (record) => {
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
    return pick(data[0]);
  }
  if (typeof data === "object" && data) return pick(data);
  return null;
}

/**
 * Asks Sperto whether `id` — an email or a Sales ID, distinguished by
 * `type` — is a staff account they know. Shared by spertoEmailExists and
 * spertoSalesIdExists below; never throws, since a login form has to be able
 * to show every outcome and a network blip must not surface as a crashed
 * route.
 */
async function spertoLookup(id, type) {
  const cfg = config();
  if (!cfg) return { ok: false, reason: "unavailable", message: "Sperto is not configured" };

  let res;
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

  // The transport status is deliberately not consulted. Their host answers
  // 200 for rejections, and the device-usage endpoint next door has been seen
  // answering 500 with a good success body — so the only evidence of what
  // happened is the body. `readSpertoBody` is the one place that reads it.
  const answer = await readSpertoBody(res, cfg.apiKey);

  if (answer.ok) return { ok: true, name: extractName(answer.body), body: answer.body };

  // Nothing usable came back — their bug or our misconfiguration, never the
  // staff member's typing.
  if (answer.reason === "unreadable") {
    return { ok: false, reason: "unavailable", message: answer.message };
  }

  // A rejection that blames the api_key is our misconfiguration wearing a
  // rejection's clothes.
  if (blamesApiKey(answer.message)) {
    return { ok: false, reason: "unavailable", message: "Sperto rejected the api_key" };
  }

  return {
    ok: false,
    reason: "not_found",
    message: answer.message ?? "Sperto does not recognise that",
  };
}

/** Asks Sperto whether `email` is a staff account they know. */
export async function spertoEmailExists(email) {
  return spertoLookup(email, "sales_manager_email");
}

/**
 * Asks Sperto whether `salesId` (e.g. "PDPL0349" — the same code used as
 * sales_manager_login on the device-usage calls, server/lib/sperto-device-usage.js)
 * is a staff account they know. Used by the login route's Sales ID sign-in so
 * that door gets the same live check the email one does, rather than
 * trusting only our own `users.sperto_login` column.
 *
 * `type: "sales_manager_login"` is inferred from their own naming (the field
 * they call `sales_manager_login` on the device-usage endpoint, mirroring
 * `type: "sales_manager_email"` above) — not yet confirmed against the live
 * host the way spertoEmailExists's three quirks are. Revisit if Sperto's
 * actual error wording here doesn't match the `not_found`/`unavailable`
 * split those quirks assume. */
export async function spertoSalesIdExists(salesId) {
  return spertoLookup(salesId, "sales_manager_login");
}

/**
 * Asks Sperto whether `leadId` is a customer they know, and hands back
 * whatever they said about them.
 *
 * This is the same door the staff member's own sign-in goes through, one
 * screen later: they type the Lead ID at `/session/start`, and it is checked
 * against the CRM that owns it rather than only against our own `leads`
 * table, which is as trustworthy as whoever last typed into it. Sperto owns
 * the customer list exactly as it owns the staff list.
 *
 * `body` comes back on success so the caller can lift the customer's name out
 * of it (see `/api/leads`), which is the one detail the presentation actually
 * needs and the one our own table may not have for a lead we've never seen.
 */
export async function spertoLeadExists(leadId) {
  return spertoLookup(leadId, "lead");
}
