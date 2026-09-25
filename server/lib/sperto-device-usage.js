import { fetchWithTimeout } from "./http.js";
import { blamesApiKey, readSpertoBody } from "./sperto-response.js";

/**
 * Records a presentation session's start/end against Sperto's
 * api_record_device_usage.php — the only Sperto API this app calls. Called from
 * server/routes/device-usage.js, which is the only thing that imports this
 * module. It lives under `server/` so the api_key never reaches the browser: their
 * CORS is wide open, so an api_key that reached the browser would be usable
 * by anyone with devtools open on a showroom tablet.
 *
 * Best-effort only, like the activity log (src/lib/activity.js): a session
 * starting or ending must never depend on Sperto being reachable.
 */

const DEFAULT_TIMEOUT_MS = 8_000;

/** Sperto's own numeric device_id per device type. Not yet given to us by
 * the client — this is a placeholder sequential mapping matching
 * DEVICE_TYPES' order (src/lib/session.js). Replace with the real mapping
 * once Sperto provides one; nothing else here needs to change. */
const DEVICE_IDS = {
  Tab: "1",
  TV: "2",
  Kiosk: "3",
  Laptop: "4",
};

/** Used when a session has no deviceType on file (walk-in/legacy sessions —
 * see the active session's `deviceType` in src/lib/session.js). */
const FALLBACK_DEVICE_ID = "1";

/** Read from env per call rather than cached, so changing an env var takes
 *  effect on the next invocation instead of the next restart. */
function config() {
  const baseUrl = process.env.SPERTO_BASE_URL?.trim().replace(/\/+$/, "");
  const apiKey = process.env.SPERTO_DEVICE_USAGE_API_KEY?.trim();
  if (!baseUrl || !apiKey) return null;
  const timeout = Number(process.env.SPERTO_TIMEOUT_MS);
  return {
    baseUrl,
    apiKey,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
  };
}

export function isDeviceUsageConfigured() {
  return config() !== null;
}

/**
 * Never throws: a failure here (network, bad credentials, Sperto down) must
 * never surface to the staff flow. No-ops silently when unconfigured.
 *
 * `params` is `{ deviceType, leadId, salesManagerLogin, type, pageUrl }`,
 * where `type` is "IN" or "OUT".
 *
 * `pageUrl` on "OUT" is the presentation's per-project minutes (two
 * decimals), one object per project — `[{ "Elena": 3 }, { "Alibaug": 4.5 }]`. On "IN" (sent at
 * sign-in, with no lead_id) nothing has been opened yet, so it keeps the
 * field's original meaning: the page on screen, as a string.
 *
 * That array is the only place the times go. The body carries their own
 * documented fields and nothing else: a `project_time` custom field was sent
 * alongside it for a while, and is deliberately gone — the client asked for
 * the numbers in `page_url` only.
 *
 * **It no longer throws the answer away.** Their server does not use HTTP
 * status codes to mean anything — a rejection and a success both arrive as
 * 200, and this endpoint has been seen answering 500 with a good success body
 * — so "did that land?" is only answerable from the body. It is read (via the
 * shared `readSpertoBody`) and returned, and a failure is logged with what
 * they actually said. Callers still don't block on it; the difference is that
 * a silently-rejected visit is now visible in the server log instead of
 * looking exactly like success.
 *
 * Resolves to `{ ok: true }`, `{ ok: false, reason, message }`, or
 * `{ ok: false, reason: "skipped" }` when there are no credentials.
 */
export async function recordDeviceUsage(params) {
  const cfg = config();
  if (!cfg) return { ok: false, reason: "skipped", message: "Device usage is not configured" };

  const deviceId = params.deviceType ? DEVICE_IDS[params.deviceType] : FALLBACK_DEVICE_ID;

  let res;
  try {
    res = await fetchWithTimeout(
      `${cfg.baseUrl}/api_record_device_usage.php`,
      {
        method: "POST",
        // Mandatory: a form-encoded
        // body is silently ignored by their server.
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          api_key: cfg.apiKey,
          device_id: deviceId,
          lead_id: params.leadId,
          sales_manager_login: params.salesManagerLogin,
          type: params.type,
          page_url: params.pageUrl,
        }),
        cache: "no-store",
      },
      cfg.timeoutMs,
    );
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    const message = aborted ? "Sperto did not respond in time" : "Could not reach Sperto";
    console.error(`[device-usage] ${params.type} for ${params.leadId || params.salesManagerLogin}: ${message}`);
    return { ok: false, reason: "unavailable", message };
  }

  const answer = await readSpertoBody(res, cfg.apiKey);
  if (answer.ok) return { ok: true };

  const reason =
    answer.reason === "rejected" && !blamesApiKey(answer.message) ? "rejected" : "unavailable";
  // Logged, not thrown and not surfaced: the presentation has already ended
  // by the time an "OUT" is sent, and there is nobody left on screen to tell.
  // What this buys is that "Sperto is dropping our visits" stops being
  // invisible.
  console.error(
    `[device-usage] ${params.type} for ${params.leadId || params.salesManagerLogin} was not recorded: ${answer.message}`,
  );
  return { ok: false, reason, message: answer.message };
}
