import "server-only";
import { fetchWithTimeout } from "./http";
import type { DeviceType } from "./session";

/**
 * Records a presentation session's start/end against Sperto's
 * api_record_device_usage.php — a separate api_key from the one
 * src/lib/sperto.ts uses for login. Called from
 * src/app/api/session/device-usage/route.ts, which is the only thing that
 * imports this module (same server-only reasoning as sperto.ts: their CORS
 * is wide open, so an api_key that reached the browser would be usable by
 * anyone with devtools open on a showroom tablet).
 *
 * Best-effort only, like the activity log (src/lib/activity.ts): a session
 * starting or ending must never depend on Sperto being reachable.
 */

const DEFAULT_TIMEOUT_MS = 8_000;

/** Sperto's own numeric device_id per device type. Not yet given to us by
 * the client — this is a placeholder sequential mapping matching
 * DEVICE_TYPES' order (src/lib/session.ts). Replace with the real mapping
 * once Sperto provides one; nothing else here needs to change. */
const DEVICE_IDS: Record<DeviceType, string> = {
  Tab: "1",
  TV: "2",
  Kiosk: "3",
  Laptop: "4",
};

/** Used when a session has no deviceType on file (walk-in/legacy sessions —
 * see ActiveSession.deviceType in src/lib/session.ts). */
const FALLBACK_DEVICE_ID = "1";

type Config = { baseUrl: string; apiKey: string; timeoutMs: number };

/** Read from env per call rather than cached, so changing a Vercel env var
 *  takes effect on the next invocation instead of the next cold start. */
function config(): Config | null {
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

export function isDeviceUsageConfigured(): boolean {
  return config() !== null;
}

export type DeviceUsageParams = {
  deviceType: DeviceType | null;
  leadId: string;
  salesManagerLogin: string;
  type: "IN" | "OUT";
  pageUrl: string;
  /**
   * Seconds the customer spent in each project they actually opened, keyed
   * by project name (see lib/project-time.ts). Sent on OUT only, and left
   * out of the body entirely when empty — a presentation where nothing was
   * opened should send no `project_time` at all rather than an empty object.
   *
   * Not in Sperto's published docs for this endpoint: it is a custom field
   * their backend has to be storing against the visit for any of this to
   * reach the CRM. Their server ignores fields it doesn't know silently and
   * answers 200 either way (see sperto.ts's note on that), so a Sperto side
   * that hasn't added it yet looks exactly like success from here. Worth
   * confirming with them rather than assuming.
   */
  projectTime?: Record<string, number>;
};

/** Fire-and-forget: never throws, and a failure here (network, bad
 * credentials, Sperto down) must never surface to the staff flow. No-ops
 * silently when unconfigured, same as isSpertoConfigured() gating login. */
export async function recordDeviceUsage(params: DeviceUsageParams): Promise<void> {
  const cfg = config();
  if (!cfg) return;

  const deviceId = params.deviceType ? DEVICE_IDS[params.deviceType] : FALLBACK_DEVICE_ID;

  try {
    await fetchWithTimeout(
      `${cfg.baseUrl}/api_record_device_usage.php`,
      {
        method: "POST",
        // Mandatory, per sperto.ts's note on this API family: a form-encoded
        // body is silently ignored by their server.
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          api_key: cfg.apiKey,
          device_id: deviceId,
          lead_id: params.leadId,
          sales_manager_login: params.salesManagerLogin,
          type: params.type,
          page_url: params.pageUrl,
          ...(params.type === "OUT" && params.projectTime && Object.keys(params.projectTime).length > 0
            ? { project_time: params.projectTime }
            : {}),
        }),
        cache: "no-store",
      },
      cfg.timeoutMs,
    );
  } catch {
    // best-effort; ignore
  }
}
