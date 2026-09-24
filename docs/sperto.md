# Sperto integration

Sperto is the client's CRM, and it owns two lists this app reads:

> Is this a staff account you know? (email, or Sales ID)
> Is this a customer you know? (Lead ID)

Both go through one endpoint, distinguished by a `type` field. The staff
question gates `/api/login`; the customer question gates `/api/leads`. Between
them, **nobody has to be pre-created in this app** — not a new salesperson, not
a new customer.

```
POST {SPERTO_BASE_URL}/api_get_details_of_customer.php
{ "api_key", "id": "<the thing typed>", "type": "<which list>" }
```

| `type` | Asked by | Answers |
|---|---|---|
| `sales_manager_email` | `/api/login` | is this staff email real |
| `sales_manager_login` | `/api/login` | is this Sales ID real |
| `lead` | `/api/leads` | is this Lead ID real |

| Concern | Where |
|---|---|
| The only code that talks to Sperto | `server/lib/sperto.js` |
| How an answer is read out of a response | `server/lib/sperto-response.js` |
| Where the answers are used | `server/routes/login.js`, `server/routes/leads.js` |
| Tests | `server/lib/sperto.test.js`, `server/lib/sperto-response.test.js` |

---

## Going live

**Setting two env vars is the whole cutover. There is no code change.**

| Variable | Local | Production |
|---|---|---|
| `SPERTO_BASE_URL` | unset | `https://net4hgc.sperto.co.in/_api` |
| `SPERTO_API_KEY` | unset | the real key |
| `SPERTO_TIMEOUT_MS` | unset (8000) | unset |

With neither set, `isSpertoConfigured()` is false and:

- the login route falls back to the demo accounts in `src/lib/users.js`,
- the leads route falls back to our own table, and the client falls back to the
  dummy directory in `src/data/customers.js`.

That is how the flow is demonstrated before the api_key lands.

⚠ **Turning Sperto on turns the dummy customers off.** `LEAD-1001`…`LEAD-1005`
are ours, not theirs, so once the CRM is answering it will refuse them — which
is correct (see "Sperto's no is final" below), but it does mean the demo
walkthrough needs a real Lead ID from that point on.

`SPERTO_API_KEY` is read **only** inside `server/lib/sperto.js`. Everything
under `server/` is a separate program from the browser bundle — it is not part
of the Vite build at all — so there is no path by which the key can reach a
client. (Under Next.js both halves compiled together and this took an
`import "server-only"` marker to guarantee; the split is now structural.)
Verify after any change:

```bash
npm run build && grep -rn "<the key value>" dist/   # must return nothing
```

---

## The flow

```
/login          email or Sales ID  ──▶  POST /api/login
                                          └─ spertoEmailExists / spertoSalesIdExists
                                               ├─ ok        → session cookie issued
                                               ├─ not_found → 401, "not registered in Sperto"
                                               └─ unavailable → 503, "try again in a moment"
                                                     ↓
/session/start  Lead ID or phone  ──▶  GET /api/leads?query=
                                          └─ spertoLeadExists
                                               ├─ ok        → their name, + our own row if we have one
                                               ├─ not_found → rejected, the session does NOT start
                                               └─ unavailable → fall through to our own table
                                                     ↓
                                       device picker
                                                     ↓
/dashboard      the presentation
```

Admin and sales-manager sign-in is **email + password** and deliberately not
Sperto-gated: an outage at the CRM must not be able to lock an admin out of
their own dashboard.

A staff email Sperto vouches for that we already know (static roster, or the
`users` table) keeps that record's role and `managerEmail`, which is what the
reporting dashboards scope teams by. An email we've never seen still signs in
— that is the point of letting Sperto own the list — as plain `sales_staff`
with no team. A Lead ID works the same way: our own `leads` row wins when we
have one, because it carries budget, tower, family size and the assignment
history that their four-field answer has no room for; their name fills the gap
when we don't.

### Sperto's "no" is final; Sperto being down is not

The two failures are kept apart everywhere, and only the first one is ever the
user's problem:

| | `not_found` | `unavailable` |
|---|---|---|
| Login | 401, "isn't registered in Sperto" | 503, "try again in a moment" |
| Lead ID | rejected — session does not start | falls through to our own table |

A CRM that is down must not be able to stop a presentation with a customer
already sitting in front of the screen. A CRM that says "I don't have that
customer" must, or the check is decoration.

---

## Their server's quirks

All verified against the live host, and the reason there is a whole module
(`server/lib/sperto-response.js`) for reading a response:

1. **Raw JSON body only.** Form-encoded bodies and query params are *ignored*,
   not rejected — which reads as "the request worked and did nothing".
   `Content-Type: application/json` is mandatory.
2. **HTTP status codes mean nothing here.** Errors come back 200. A real
   device-usage success has been seen coming back **500**. So the transport
   status is not evidence in either direction: read the body, branch on
   `body.status`. Both integrations now do, through the same function.
3. **The response is labelled `text/html`** even though it is JSON.
   `res.json()` is a coin flip across runtimes on that; `res.text()` then
   `JSON.parse` is not.
4. **Error bodies echo the request back, api_key included**, and those
   messages end up in our logs. The key is stripped before anything else
   touches the text.

An **empty** body is its own outcome — `unreadable`, never a rejection. That
matters because of the bug below: reading "no body at all" as "no such user"
would lock out valid staff.

---

## ⚠ Login endpoint bug (recorded 2026-08-24 — re-test before going live)

The client confirmed `SPERTO_API_KEY` is the same key already provided for
device-usage. Tested live against `api_get_details_of_customer.php`:

| Request | Result |
|---|---|
| Valid key + valid email, `type: "sales_manager_email"` | **HTTP 500, empty body** |
| Valid key + `"PDPL0349"`, `type: "sales_manager_login"` | **HTTP 500, empty body** |
| Valid key + `"985038"`, `type: "lead"` | **HTTP 500, empty body** |
| Valid key + email, `type: "totally_bogus_type"` | **HTTP 500, empty body** |
| Valid key + email, **no `type` field at all** | HTTP 500, `{"status":"error","message":"Data not found"}` |
| **Invalid** key + email + `type` | HTTP 200, `{"status":"error","message":"Invalid API Key"}` |

The key itself was accepted fine — a genuinely wrong key got a clean 200 — but
the endpoint 500'd with no body the instant any `type` value was present,
whatever that value was. That looked like a server-side bug in
`api_get_details_of_customer.php`, triggered by the `type` parameter, and was
reported to the client.

**Our side now survives it either way.** An empty body is classified
`unreadable` → `unavailable`, so the bug reads as "Sperto is having a
problem", not as "your email is wrong". And since the status code is no longer
consulted, a fixed endpoint answering 200 *or* 500 with a real body is read
correctly without a code change.

Re-test the six rows above before enabling `SPERTO_API_KEY` in production, and
confirm the success shape (open question 1 below).

---

## Open questions for the client

1. **What does a success body actually look like?** We have only ever seen
   error bodies. Anything that is *not* an explicit failure token
   (`0`/`false`/`error`/`fail`/`failure`/`no`) is read as success — including a
   body with no `status` field at all. If their server can say "no" some other
   way, this needs revisiting.
2. **What is the exact wording of their error messages?** Only the api_key
   pattern is matched specifically; everything else is read as "not found". A
   misread there rejects a valid staff member or a valid customer.
3. **Is `type: "sales_manager_login"` right for a Sales-ID lookup, and `"lead"`
   for a Lead ID?** Both are inferred from their own field naming. The
   empty-500 bug meant we could never tell "wrong type value" from "right
   value, broken endpoint".
4. **Is `page_url` as an array of `{ project: minutes }` acceptable to their
   parser?** See below.

---

## Second integration: device usage

A separate endpoint, separate `api_key`: "IN" the moment a staff member signs
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
| `sales_manager_login` | `users.sperto_login`, set per account by an admin (Staff → Add Account) | unset for most existing accounts, so those sessions skip the call rather than send a made-up login |
| `type` | `"IN"` / `"OUT"` | confirmed (client's call) |
| `page_url` | **per-project minutes on OUT** (`src/lib/project-time.js`) — see below | **shape changed; confirm with the client** |

If a signed-in account has no `sperto_login` on file, the route no-ops
(`{ok:true, recorded:false, skipped:...}`) rather than sending a made-up value.

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
and `sperto.test.js` covers all three lookups with `fetch` stubbed.

For an end-to-end run, a throwaway stand-in server that mimics their quirks
(JSON labelled `text/html`, 200 for rejections, 500 for a device-usage
success) and logs every payload it receives is enough to exercise the whole
staff flow against real code. Point `SPERTO_BASE_URL` at it and set any
`SPERTO_API_KEY`. That is how the array shape above was verified.
