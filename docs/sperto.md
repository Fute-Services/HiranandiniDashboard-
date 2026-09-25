# Sperto integration

Sperto is the client's CRM. This app calls **one** of its APIs,
`api_record_device_usage.php`: "IN" when a staff member signs in, "OUT" when
they sign out. Nothing else.

`api_get_details_of_customer.php` — which used to check a staff email/Sales
ID at login and a Lead ID on the next screen — is no longer called anywhere,
on the client's instruction. That endpoint also returned HTTP 500 with an
empty body whenever a `type` field was sent (last re-tested 2026-09-25), which
kept valid Sales IDs from signing in.

What that means for the flow:

- **Login** takes a Sales ID (e.g. `PDPL0349`) and nothing else — an email is
  refused, since it gives IN/OUT no `sales_manager_login` to send. The Sales ID
  is not verified; it is signed into the session and sent as
  `sales_manager_login`.
- **Lead ID** is taken as typed and sent as `lead_id` on OUT.

## Going live

| Variable | Value |
|---|---|
| `SPERTO_BASE_URL` | `https://net4hgc.sperto.co.in/_api` |
| `SPERTO_DEVICE_USAGE_API_KEY` | the real key |
| `SPERTO_TIMEOUT_MS` | optional, default 8000 |

Without both, IN/OUT are skipped (logged, never blocking a presentation).
The key is read only in `server/lib/sperto-device-usage.js`; nothing under
`server/` is part of the browser bundle. Verify after any change:

```bash
npm run build && grep -rn "<the key value>" dist/   # must return nothing
```

## Their server's quirks

1. **Raw JSON body only.** Form-encoded bodies are silently ignored.
2. **HTTP status codes mean nothing.** Errors come back 200; a real
   device-usage success has been seen coming back 500. The body is read, in
   `server/lib/sperto-response.js`, and the status ignored.
3. **The response is labelled `text/html`** even though it is JSON.
4. **Error bodies echo the request back, api_key included** — stripped before
   anything is logged.

## Device usage

"IN" the moment a staff member signs
in, "OUT" when they sign out (the client's call, 2026-09-24):

```
POST {SPERTO_BASE_URL}/api_record_device_usage.php
{ "api_key", "device_id", "lead_id", "sales_manager_login",
  "type": "IN"|"OUT",
  "page_url": [ { "<project>": 3 }, ... ] }

# Nothing else. The per-project minutes go out in page_url and in no
# other field — a custom project_time was sent alongside it for a while
# and the client asked for it to stop.
```

| Concern | Where |
|---|---|
| The only code that talks to this endpoint | `server/lib/sperto-device-usage.js` |
| Server-side route the client actually calls | `server/routes/device-usage.js` |
| Where it fires | `src/lib/session.js` — `recordLoginIn` ("IN", called from the login page on success), `finalizeSession` ("OUT", on every sign-out) |
| Per-project minutes + URLs | `src/lib/project-time.js` (tests: `project-time.test.js`) |

The api_key lives only in `server/lib/sperto-device-usage.js`, so the browser
never sees it — it POSTs to our own `/api/session/device-usage` route, which
looks up the signed-in staff member's Sperto identifiers and does the real
call.

Fields, and where each comes from:

| Field | Source | Status |
|---|---|---|
| `api_key` | `SPERTO_DEVICE_USAGE_API_KEY` env var | set |
| `device_id` | `DEVICE_IDS` map in `sperto-device-usage.js`, keyed by device type (Tab/TV/Kiosk/Laptop) | **placeholder** — sequential guess 1/2/3/4, not confirmed by the client |
| `lead_id` | on "OUT", the Lead ID the staff member typed (Sperto-verified); **empty on "IN"**, which goes at sign-in before any customer is looked up, and on an "OUT" from a sign-in that never started a presentation | client asked for IN at login, OUT at logout (2026-09-24) |
| `sales_manager_login` | the Sales ID typed at sign-in, signed into the session token | set |
| `type` | `"IN"` / `"OUT"` | confirmed (client's call) |
| `page_url` | **per-project minutes on OUT** (`src/lib/project-time.js`) — see below | **shape changed; confirm with the client** |

If a session somehow has no Sales ID, the route does not send a made-up
value: it answers `{ok:true, recorded:false, skipped:...}` and logs it.

### The answer is no longer thrown away

This client used to `await` the call and discard the response entirely. Given
quirk 2 above — a rejection arrives as HTTP 200 — that meant **a visit Sperto
refused to store was indistinguishable from one it stored**, and the only
symptom was numbers quietly missing from the CRM.

It now reads the body through the same `readSpertoBody` the login check uses,
and `/api/session/device-usage` answers:

```jsonc
{ "ok": true, "recorded": true }                          // stored
{ "ok": true, "recorded": false, "reason": "rejected" }    // Sperto said no
{ "ok": true, "recorded": false, "reason": "unavailable" } // unreachable, or nothing usable came back
```

`ok` stays `true` and the status stays 200 in every case **on purpose**: this
is a best-effort side log, and a presentation must be free to start and to end
whether or not the CRM accepted the write. The caller has usually navigated
away by the time an "OUT" answers. What changed is that a failure is now
logged server-side with Sperto's own words:

```
[device-usage] OUT for 985038 was not recorded: Visit could not be stored
```

So "Sperto is dropping our visits" is something you can see in a log instead
of something you find out from the client months later.

### `page_url`: the visit array

On "OUT", `page_url` carries **the presentation's per-project minutes, one
object per project**, in the order the projects were first opened. On "IN" —
and on an "OUT" where no project was ever opened — there is no time to report,
so the field keeps its original meaning: the page in front of the customer.

```jsonc
// "IN" — nothing opened yet.
"page_url": "https://…/dashboard"

// "OUT" — one object per project the customer actually opened.
"page_url": [ { "Elena": 3 }, { "Alibaug": 4.5 } ]
```

**Why this field, and only this field.** It is theirs and always has been, so
it is the one field the times can travel in without the client having to add
anything. A custom `project_time` carrying the same numbers as one object used
to go out beside it, as insurance against their parser ignoring the array;
the client asked for the array alone, so it is gone, and a test asserts the
"OUT" body carries nothing but their own documented fields.

An empty array is never sent — it would read as a visit with no projects in
it, which is a claim the page URL does not make. A project that rounds to 0 minutes
is left out for the same reason.

⚠ **Confirm their parser accepts an array here.** It previously received a
single URL string. Their server ignores what it doesn't understand and answers
200 either way — so a parser that still expects a string looks exactly like
success from our side. The route still accepts a plain string inbound, so an
older tab mid-session keeps reporting.

The route re-validates it server-side (`sanitizePageUrl`) before forwarding —
it arrives from a browser. Entries that are not a project name against a
finite positive number are dropped, the array is capped at 50 entries, and if
nothing survives the field falls back to the request's own origin rather than
going out empty.

### How the minutes are counted

What the accumulator (`src/lib/project-time.js`) guarantees, each covered by a
test in `project-time.test.js`:

| Rule | How |
|---|---|
| Only projects that were actually opened appear | keys are created on open; a project rounding to 0s is dropped rather than sent as `0` |
| Reopening adds, never duplicates | totals are keyed by project name, so A (3 min) + A (2 min) = one `300`, and one array entry |
| Two projects never run at once | `startProjectTimer` banks the previous project's time before starting the next |
| Background tabs don't accrue time | `visibilitychange` pauses and resumes the running clock |
| A refresh doesn't invent time | state lives in `sessionStorage`; the showcase closes the dangling clock on mount, keeping the time up to the reload |
| The project on screen at logout is counted | `getProjectVisits()` banks the running clock before reading |
| Exactly one "OUT" per presentation | a `sessionStorage` claim flag in `session.js` |
| One customer's time never lands on the next | `recordLoginIn` and `setActiveSession` clear the totals; `recordLoginIn` re-arms the OUT flag |

Times are held in milliseconds and converted to minutes, two decimals (90s is
`1.5`, 45s is `0.75`), once, at send time — whole minutes would drop every
look under 30s, and rounding each visit separately would lose a little per open.

"OUT" fires on **every** way a session ends — the showcase's Log out, the Log
out inside a project's full-screen viewer, an idle timeout, and an admin
force-logout — because `signOut()` calls `finalizeSession()`. It goes even
when no presentation was started, since every sign-in already sent its "IN".

**Before this goes live for real staff, get from the client:**
1. The real `device_id` per device type — update `DEVICE_IDS`.
2. Each real staff member's Sperto login code (Staff → Add Account's "Sperto
   login" field, or a DB update on `users.sperto_login`).
3. Confirmation that `page_url` as an array of `{ project: minutes }` is
   accepted by their parser. It is now the only field the times are in, so
   if their parser still expects a string, the numbers reach nobody.

---

## Testing it without the real key

`server/lib/sperto-response.test.js` covers the response-reading rules — 200
rejections, 500 successes, empty bodies, the api_key never echoing back out —
and `sperto-device-usage.test.js` covers the IN/OUT body.

For an end-to-end run, a throwaway stand-in server that mimics their quirks
(JSON labelled `text/html`, 200 for rejections, 500 for a device-usage
success) and logs every payload it receives is enough to exercise the whole
staff flow against real code. Point `SPERTO_BASE_URL` at it and set any
`SPERTO_DEVICE_USAGE_API_KEY`. That is how the array shape above was verified.
