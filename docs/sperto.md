# Sperto integration

Sperto is the client's CRM. We ask it exactly one question:

> Is this email a staff account you know?

That is the whole integration. `/api/login` asks it before issuing a session,
so **Sperto owns the staff list** — nobody has to pre-create accounts in this
app for a new salesperson to be able to sign in.

```
POST {SPERTO_BASE_URL}/api_get_details_of_customer.php
{ "api_key", "id": "<the email>", "type": "sales_manager_email" }
```

| Concern | Where |
|---|---|
| The only code that talks to Sperto | `src/lib/sperto.ts` (~160 lines) |
| Where the answer is used | `src/app/api/login/route.ts` |
| Tests | `src/lib/sperto.test.ts` |

---

## Going live

**Setting two env vars is the whole cutover. There is no code change.**

| Variable | Local | Production |
|---|---|---|
| `SPERTO_BASE_URL` | unset | `https://net4hgc.sperto.co.in/_api` |
| `SPERTO_API_KEY` | unset | the real key |
| `SPERTO_TIMEOUT_MS` | unset (8000) | unset |

With neither set, `isSpertoConfigured()` is false and the login route falls
back to the demo accounts in `src/lib/users.ts` — that is how the flow is
demonstrated before the api_key lands.

`SPERTO_API_KEY` is read **only** inside `src/lib/sperto.ts`, which is marked
`import "server-only"` — importing it from a client component is a build
error. There is no `NEXT_PUBLIC_` variant and no client-side fetch to Sperto.
Verify after any change to that module:

```bash
npm run build && grep -r "<the key value>" .next/static/   # must return nothing
```

---

## The flow

```
/login          email only  ──▶  POST /api/login
                                   └─ spertoEmailExists(email)
                                        ├─ ok        → session cookie issued
                                        ├─ not_found → 401, "not registered in Sperto"
                                        └─ unavailable → 503, "try again in a moment"
                                              ↓
/session/start  Lead ID or phone  ──▶  our own leads lookup, device picker
                                              ↓
/dashboard      the presentation
```

Admin and sales-manager sign-in is **email + password** and deliberately not
Sperto-gated: an outage at the CRM must not be able to lock an admin out of
their own dashboard.

An email Sperto vouches for that we already know (static `USERS`, or the
`users` table) keeps that record's role and `managerEmail`, which is what the
reporting dashboards scope teams by. An email we've never seen still signs in
— that is the point of letting Sperto own the list — as plain `sales_staff`
with no team.

---

## Their server's three quirks

All verified against the live host, and the reason `sperto.ts` is 160 lines
rather than 20:

1. **Raw JSON body only.** Form-encoded bodies and query params are *ignored*,
   not rejected — which reads as "the request worked and did nothing".
   `Content-Type: application/json` is mandatory.
2. **Errors come back HTTP 200.** `res.ok` is true for every failure they
   have. Branch on `body.status`, never on the transport status.
3. **The response is labelled `text/html`** even though it is JSON.
   `res.json()` is a coin flip across runtimes on that; `res.text()` then
   `JSON.parse` is not.

`not_found` and `unavailable` are kept apart on purpose. Only the first should
ever block a login — telling a staff member their email is wrong when the real
problem is our api_key is how a five-minute fix becomes an afternoon.

---

## ⚠ Login endpoint is currently broken (confirmed 2026-08-24)

The client confirmed `SPERTO_API_KEY` is the same key already provided for
device-usage (the real value lives in `.env.local`, gitignored — not
repeated here). Tested live against `api_get_details_of_customer.php` with
that key:

| Request | Result |
|---|---|
| Valid key + valid email, `type: "sales_manager_email"` | **HTTP 500, empty body** |
| Valid key + `"PDPL0349"`, `type: "sales_manager_login"` | **HTTP 500, empty body** |
| Valid key + `"985038"`, `type: "lead"` | **HTTP 500, empty body** |
| Valid key + email, `type: "totally_bogus_type"` | **HTTP 500, empty body** |
| Valid key + email, **no `type` field at all** | HTTP 500, `{"status":"error","message":"Data not found"}` |
| **Invalid** key + email + `type` | HTTP 200, `{"status":"error","message":"Invalid API Key"}` |

So: the key itself is accepted fine (a genuinely wrong key gets a clean 200
response) — the endpoint 500s with **no body whatsoever** the instant any
`type` value is present, regardless of what that value is. This isn't a
guessing problem on our end (`sales_manager_email`, which was already
believed to be correct and unchanged by us, fails identically to a made-up
type). It looks like a server-side bug in `api_get_details_of_customer.php`
itself, triggered by the `type` parameter — needs to be reported to the
client/Sperto to fix on their end.

**Until it's fixed**, `SPERTO_API_KEY` is deliberately left commented out in
`.env.local` — setting it makes every staff login attempt fail (including
the local demo account), since `isSpertoConfigured()` becoming true stops
the route from falling back to local demo accounts. Uncomment it once the
client confirms the endpoint is fixed; no code change will be needed.

For comparison, the device-usage endpoint (`api_record_device_usage.php`)
also returns HTTP 500 on a real success (`{"status":"success"}` at 500, not
200) — so their whole `_api` host seems to not use HTTP status codes
meaningfully at all. Our device-usage client (`sperto-device-usage.ts`)
already doesn't check `res.ok` for this reason (fire-and-forget), but
`sperto.ts`'s login check does, via the shared `spertoLookup` — that's a
second thing to revisit once the 500-with-empty-body issue above is
resolved, since a real error and a real success may both currently arrive
as HTTP 500 there too and only be distinguishable by body content.

---

## Other open questions — ask these once the endpoint above is fixed

1. **What does a success body actually look like?** We have only ever seen
   error bodies. The client treats anything that is *not* an explicit failure
   token (`0`/`false`/`error`/`fail`/`failure`/`no`) as success. If their
   server can answer with no status field at all, this needs revisiting.
2. **What is the exact wording of their error messages?** Only the api_key
   pattern is matched specifically; everything else is read as "unknown
   email". A misread there rejects a valid staff member, so it is worth
   confirming.
3. **Is `type: "sales_manager_login"` actually right for a Sales-ID lookup?**
   Still unconfirmed — the empty-500 bug above means we haven't been able to
   distinguish "wrong type value" from "right type value, broken endpoint"
   for any type at all yet.

---

## Third integration: Sales ID sign-in

Staff can type either their email or their Sperto **Sales ID** (e.g.
"PDPL0349") on the login screen. The Sales ID is the same code stored in
`users.sperto_login` (added for the device-usage integration above) and used
as `sales_manager_login` there.

```
Sales ID typed  ──▶  resolveEmailFromSalesId(id)          (src/app/api/login/route.ts)
                        └─ users.sperto_login lookup — decides WHICH account,
                           not whether the ID is real
                              ↓
                     spertoSalesIdExists(id)                (src/lib/sperto.ts)
                        └─ the actual "is this real" check, same live gate
                           the email door gets
```

Two separate checks on purpose: the local lookup only says which of *our*
accounts claims this ID (as trustworthy as whoever last typed it into the
"+ Add Staff" form); the Sperto call is what actually confirms the ID is
live. Both must pass — see open question 3 above for the one thing about the
second check that's still unconfirmed.

## Second integration: device usage

A separate endpoint, separate `api_key`, logged every time a presentation
session starts and ends:

```
POST {SPERTO_BASE_URL}/api_record_device_usage.php
{ "api_key", "device_id", "lead_id", "sales_manager_login", "type": "IN"|"OUT", "page_url" }

# and on "OUT" only, when at least one project was opened:
{ ..., "project_time": { "Fortune City": 300, "Alibaug": 240 } }
```

| Concern | Where |
|---|---|
| The only code that talks to this endpoint | `src/lib/sperto-device-usage.ts` |
| Server-side route the client actually calls | `src/app/api/session/device-usage/route.ts` |
| Where it fires | `src/lib/session.ts` — `setActiveSession` ("IN"), `finalizeSession` ("OUT") |
| Per-project seconds accumulator | `src/lib/project-time.ts` (tests: `project-time.test.ts`) |

```
Start Session  ──▶  setActiveSession(lead, deviceType)
                       └─ POST /api/session/device-usage {type:"IN", ...}
                            └─ recordDeviceUsage() → api_record_device_usage.php

End Session    ──▶  finalizeSession()
                       └─ POST /api/session/device-usage {type:"OUT", ...}
                            └─ recordDeviceUsage() → api_record_device_usage.php
```

Same server-only reasoning as the login integration: the api_key lives only in
`sperto-device-usage.ts` (`import "server-only"`), so the browser never sees
it — it POSTs to our own `/api/session/device-usage` route, which looks up
the signed-in staff member's Sperto identifiers and does the real call.

Fields, and where each comes from:

| Field | Source | Status |
|---|---|---|
| `api_key` | `SPERTO_DEVICE_USAGE_API_KEY` env var | set |
| `device_id` | `DEVICE_IDS` map in `sperto-device-usage.ts`, keyed by `DeviceType` (Tab/TV/Kiosk/Laptop) | **placeholder** — sequential guess 1/2/3/4, not confirmed by the client |
| `lead_id` | our own `Lead.leadId`, sent as-is | confirmed (client's call) |
| `sales_manager_login` | `users.sperto_login` column, set per account by an admin (Staff → Add Account) | added — unset for most existing accounts, so those sessions skip the call rather than send a made-up login |
| `type` | `"IN"` / `"OUT"` | confirmed (client's call) |
| `page_url` | `window.location.href` at the moment the call fires | assumed — the client's own example payload just used their CRM's own URL |
| `project_time` | `src/lib/project-time.ts`, keyed by project name from `src/data/properties.ts` | **custom field — not in their docs.** See below |

If a signed-in account has no `sperto_login` on file, the route no-ops
(`{ok:true, skipped:...}`) rather than sending a made-up value — same
best-effort philosophy as the activity log: this must never block a session
from starting or ending.

**Before this goes live for real staff, get from the client:**
1. The real `device_id` per device type (Tab/TV/Kiosk/Laptop) — update
   `DEVICE_IDS` in `sperto-device-usage.ts`.
2. Each real staff member's Sperto login code, entered via Staff → Add
   Account's "Sperto login" field (or a DB update on `users.sperto_login` for
   existing accounts).
3. **Confirmation that `project_time` is stored on their side** — see the
   next section.

### `project_time`: per-project viewing time

Sent once per presentation, on the "OUT" call, as `{ "<project name>":
<seconds> }` for every project the customer actually opened.

`api_record_device_usage.php`'s published fields do **not** include
`project_time`. It is a custom field the client asked for, and Sperto's
backend has to be reading and storing it for any of this to reach the CRM.
Their server ignores unknown fields silently, so a Sperto side that hasn't
added it yet is indistinguishable from success here — **confirm with them,
don't assume.** Nothing on our side changes either way; the field is already
being sent.

What the accumulator (`src/lib/project-time.ts`) guarantees, each covered by
a test in `project-time.test.ts`:

| Rule | How |
|---|---|
| Only projects that were actually opened appear | keys are created on open; a project rounding to 0s is dropped rather than sent as `0` |
| Reopening adds, never duplicates | totals are keyed by project name, so A (3 min) + A (2 min) = one `300` |
| Two projects never run at once | `startProjectTimer` banks the previous project's time before starting the next — this is the "stop previous, start new" navigation case |
| Background tabs don't accrue time | `visibilitychange` pauses and resumes the running clock |
| A refresh doesn't invent time | state lives in `sessionStorage` (same lifetime as the active session); the showcase closes the dangling clock on mount, keeping the time up to the reload |
| The project on screen at logout is counted | `getProjectTimeSeconds()` banks the running clock before reading |
| Exactly one "OUT" per presentation | a `sessionStorage` claim flag in `session.ts` — the showcase's Log out and `signOut()` both call `finalizeSession`, and only the first one sends |
| One customer's time never lands on the next | `setActiveSession` clears both the totals and the OUT flag |

Times are held in milliseconds and converted to whole seconds once, at send
time — rounding each visit separately would lose up to half a second per open,
which on a project opened a dozen times is a visible undercount.

The route re-validates the map server-side (`sanitizeProjectTime`) before
forwarding: it arrives from the browser, and non-numeric, negative or
empty-keyed entries are dropped rather than passed into the client's CRM.

Note that "OUT" now fires on **every** way a session ends — the showcase's Log
out, an idle timeout, and an admin force-logout — because `signOut()` calls
`finalizeSession()`. Before this, only the Log out button reported "OUT", so
an idled-out session left Sperto believing the customer was still in the room.
