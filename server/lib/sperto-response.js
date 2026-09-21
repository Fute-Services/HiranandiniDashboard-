/**
 * Reading an answer out of Sperto, shared by both integrations.
 *
 * Their `_api` host does not use HTTP status codes to mean anything. A
 * rejection and a success both arrive as 200, and the device-usage endpoint
 * has been seen answering 500 with a perfectly good success body. So the
 * transport status is not evidence either way: **read the body, branch on
 * `status` inside it.** That is the one rule this module exists to enforce in
 * exactly one place, rather than twice, slightly differently.
 *
 * Two more quirks it handles, both verified against the live host:
 *
 * - The body is labelled `text/html` even though it is JSON. `res.json()` is
 *   a coin flip across runtimes on that; `res.text()` then `JSON.parse` is
 *   not.
 * - Their error bodies echo the request back, `api_key` included, and those
 *   messages end up in our logs. The key is stripped before anything else
 *   touches the text.
 *
 * The result is one of:
 * - `{ ok: true, body }`            — they said yes.
 * - `{ ok: false, reason: "rejected", message, body }`
 *                                   — they answered, and the answer was no.
 *                                     The only outcome a caller should ever
 *                                     treat as the user's problem.
 * - `{ ok: false, reason: "unreadable", message }`
 *                                   — nothing usable came back: not JSON, not
 *                                     an object, or an empty body. Their
 *                                     problem or ours, never the user's.
 */

/** What their `status` field says when the answer is no. Anything else —
 * including no `status` field at all — is read as success, because we have
 * only ever been shown error bodies and a success shape that omits it is more
 * likely than one that means "no" in a word not on this list. */
const FAILURE_TOKENS = new Set(["0", "false", "error", "fail", "failure", "no"]);

/** Their error bodies echo the request, api_key included, and this text can
 * end up in a log. Strip it. */
export function redact(text, apiKey) {
  return apiKey ? text.split(apiKey).join("***") : text;
}

/**
 * Reads one Sperto response. Never throws — every caller here is either a
 * login form that has to be able to show each outcome, or a fire-and-forget
 * side log that must not be able to break a presentation.
 */
export async function readSpertoBody(res, apiKey) {
  let raw;
  try {
    raw = redact(await res.text(), apiKey);
  } catch {
    return { ok: false, reason: "unreadable", message: "Sperto's response could not be read" };
  }

  if (!raw.trim()) {
    // The documented failure mode of `api_get_details_of_customer.php` when
    // it hits its own bug: HTTP 500 and not one byte of body. Worth naming in
    // the message, since "empty" is the whole diagnosis.
    return {
      ok: false,
      reason: "unreadable",
      message: `Sperto returned an empty body (HTTP ${res.status})`,
    };
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "unreadable", message: "Sperto returned a body that is not JSON" };
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, reason: "unreadable", message: "Sperto returned an unexpected body" };
  }

  const status = body.status;
  const failed =
    status === false ||
    status === 0 ||
    (typeof status === "string" && FAILURE_TOKENS.has(status.trim().toLowerCase()));

  if (failed) {
    const message = ["message", "msg", "error"]
      .map((k) => body[k])
      .find((v) => typeof v === "string" && v.trim().length > 0);
    return { ok: false, reason: "rejected", message: message ?? "Sperto said no", body };
  }

  return { ok: true, body };
}

/** True when a rejection is really our misconfiguration wearing a rejection's
 * clothes. Saying "that isn't recognised" at somebody whose email or Sales ID
 * was fine all along is how a five-minute fix becomes an afternoon. */
export function blamesApiKey(message) {
  return Boolean(message) && /api[_ -]?key|unauthori[sz]|authentication|forbidden/i.test(message);
}
