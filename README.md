# Hiranandani Properties Showcase — Website

React (Vite, JSX) single-page app, with the API it talks to as a plain Express
server in the same repo.

This was a Next.js App Router + TypeScript app until the port described in
[Ported off Next.js](#ported-off-nextjs) below. Behaviour is unchanged; the
screens, the flow and every API contract are the same.

## Run

```bash
npm install

# Required before the first run — the login mints a signed session cookie
# and refuses to sign anything without a key (see Environment below).
cp .env.example .env.local
node -e 'console.log("SESSION_SECRET=" + require("crypto").randomBytes(32).toString("base64url"))'
# …paste that into .env.local

npm run dev      # http://localhost:3000 (app) + :3001 (api), both together
npm run build    # → dist/
npm start        # serves dist/ AND the API from one process, port 3001
```

`npm run dev` starts two processes: Vite on **3000** serving the app, and the
API on **3001**. Vite proxies `/api` to it (see `vite.config.js`), so the
browser only ever sees one origin — which is what keeps the `SameSite=Lax`
session cookie and the API's CSRF origin check working. Run them separately
with `npm run dev:web` and `npm run dev:server` if you'd rather.

In production there is no proxy: `npm start` serves the built `dist/` and the
API from the same Express process, so it is one origin for real.

## Deploy

### Vercel

Zero configuration beyond what is already in the repo. `vercel.json` sets the
framework, the build and the rewrites; the API is one Serverless Function at
`api/index.js` that hands every `/api/*` request to the same Express app
`npm start` runs.

```
dist/             served by the CDN
api/index.js  ->  server/app.js   (all of /api/*)
```

`/api/*` is routed there by an explicit rewrite rather than by a catch-all
filename. `api/[...path].js` was tried first and Vercel matched it only one
segment deep — `/api/login` reached the function while
`/api/session/device-usage` returned Vercel's own 404. The rewrite carries the
real path in `__vercel_path`, and `api/index.js` puts it back on `req.url`
before Express sees it, so the routers stay mounted on the real paths and the
same app still runs unchanged under `npm start`.

The rewrite `/((?!api/).*) -> /index.html` is what makes a hard load of
`/session/start` work: Vercel checks the filesystem first, so real files
(`/assets/*`, `/brand/*`) still serve, and only client-side routes fall
through to the app.

Set `SESSION_SECRET` in the project's environment variables before the first
deploy — the build succeeds without it and every sign-in then 500s. Everything
else in the Environment table below is optional.

Two things behave differently on serverless than on a long-lived process, both
by nature rather than by choice:

- **The API's own state** — staff controls, admin-added accounts, unit counts,
  the lead overlay (`server/lib/store.js`) — is process memory, so a cold
  start clears it and two instances do not share it. Nothing in the sales flow
  breaks when it is empty: an unknown account is simply one nobody has kicked
  or suspended. A manager's force-logout can, however, be forgotten by a cold
  start, so treat it as an immediate action rather than a lasting one.
- **Rate limiting** is per-instance, since the counters are in memory.

The activity log is unaffected by any of this — it never leaves the browser
tab. See "Where the activity log is stored".

### Any Node host

One process serves everything:

```bash
npm ci
npm run build
NODE_ENV=production SESSION_SECRET=… node server/index.js
```

It listens on `API_PORT` (default 3001) and serves `dist/` alongside `/api`,
including the single-page fallback. Put whatever fronts it (nginx, a platform
router) in front of that one port; don't split the app and the API across two
origins, or the session cookie stops being sent and the CSRF check starts
refusing every POST.

## The sales staff flow

Three screens, in order:

1. **`/login`** — email or Sales ID, one step. Admin and sales managers sign
   in with email + password behind the "Admin / Manager login" link.
2. **`/session/start`** — the customer lookup (Lead ID or phone number), then
   the device picker.
3. **`/dashboard`** — the 360° VR tour and property showcase.

There is no intro splash, no Earth transition and no separate customer-search
screen.

## Dummy data, and where the real API plugs in

The staff flow runs end-to-end with **no database and no API credentials**.
Customer lookups fall back to `src/data/customers.js`, a fixed list of five
customers (`LEAD-1001` … `LEAD-1005`, each also findable by phone number).

To wire up the client's real customer API, change **one file**: point
`findDummyCustomer` in `src/data/customers.js` at the API, or delete the
fallback in `src/lib/leads.js`'s `findLead` and let its existing `/api/leads`
call be the only path. Nothing else in the flow reads that file.

Test accounts: `admin@hiranandani.com` / `admin123`,
`manager@hiranandani.com` / `manager123`, and the staff accounts
`staff@hiranandani.com`, `aditya@hiranandani.com`,
`sneha@hiranandani.com` (all `staff123`).

Staff sign in with **email or Sales ID, and no password**: it is checked
against Sperto, the client's CRM, and one they don't have is a rejection. The
**Lead ID** typed on the next screen is checked the same way, against the same
CRM — Sperto owns the customer list as well as the staff list, so a Lead ID it
doesn't have does not start a presentation. See
[docs/sperto.md](docs/sperto.md).

Without `SPERTO_BASE_URL` and `SPERTO_API_KEY` set, both checks fall back to
the accounts and customers listed here, so the flow still runs locally with no
credentials at all. ⚠ Turning Sperto on therefore turns the dummy customers
off: `LEAD-1001`…`LEAD-1005` are ours, not theirs, so the CRM will refuse
them.

Admin and manager sign-in is currently refused outright — reporting is out of
scope for this release. `REPORTING_ENABLED` is the only switch; flip it in
**both** `src/lib/auth.js` and `server/lib/auth.js` to bring the dashboards
back. Two copies on purpose: a client-side constant can be edited in devtools,
so the route that issues sessions must not take the browser's word for it.

### Environment

| Variable | Needed for |
|---|---|
| `SESSION_SECRET` | Required. Signs the session cookie the API verifies. |
| `API_PORT` | Optional (default 3001). Where the API listens; Vite's dev proxy reads it too. |
| `SPERTO_BASE_URL` | The CRM that verifies staff emails at login, and that logs device usage. Unset locally. |
| `SPERTO_API_KEY` | Server-side only — never reaches the browser. Unset locally. |
| `SPERTO_DEVICE_USAGE_API_KEY` | Separate key for the device-usage log (`docs/sperto.md`'s second integration). Server-side only. |
| `VITE_SENTRY_DSN` | Optional. Client-side error reporting. **Must** be `VITE_`-prefixed to reach the browser bundle. |

Optional: `SPERTO_TIMEOUT_MS` (default 8000).

Only `VITE_`-prefixed variables reach the browser. Everything else in
`.env.local` stays on the server, which is the right default for all of the
above — `SPERTO_API_KEY` in particular is the one that must never ship.

There is no database variable, and that is deliberate — see "No database".

### No database

This app stores nothing of its own, anywhere. There is no `DATABASE_URL`, no
Postgres, no migrations and no table of customers or staff history. The
customer records belong to the client and stay in their CRM (Sperto); what is
left is split between two places, both disposable:

| What | Where | Lifetime |
|---|---|---|
| Activity log, session data, per-project times | The browser tab's `sessionStorage` | Until the tab closes or the staff member signs out |
| Lead overlay (who claimed what, status) | The API process's memory (`server/lib/store.js`) | Until that staff member signs out |
| Staff controls, admin-added accounts, unit counts | The API process's memory | Until the process restarts |

Signing out wipes the first two. In the browser, `src/lib/sign-out.js` clears
the activity log, the active session and the project timers; on the API,
`POST /api/logout` drops every lead that sitting touched. The third row
deliberately outlives a sign-out: a suspension undone by the very logout it
caused would be no suspension at all, and admin-entered accounts and unit
counts are configuration rather than session data.

Everything is written so that an empty store is the ordinary starting state,
not an error: an account nobody has kicked, a project with no unit count
entered, a lead nobody has claimed yet. That is what makes losing either side
acceptable rather than a failure to handle.

### Where the activity log is stored

Every tracked event — login, search, customer lookup, project open/close,
property shown, step timings, logout (the full list is in
`src/lib/activity.js`) — is written to this browser tab's `sessionStorage` as
it happens. Nothing is sent to the server, and the most recent 5000 events are
kept.

`sessionStorage` rather than `localStorage` is the point: it is scoped to the
tab, so closing it clears the log and a second tab starts empty. Signing out
clears it too (`src/lib/sign-out.js`), so a showroom screen handed to the next
customer is not still carrying the last one's session.

Filters, unchanged from when this was an API: `staffEmail`, `managerEmail`,
`leadId`, `project` (substring of the label or lead name), `from`, `to`.

To see what has been recorded, in the browser's console:

```js
JSON.parse(sessionStorage.getItem("hiranandani.activity"))
```

**Two consequences, neither a bug.** A manager sees only their own browser's
log — the log cannot cross devices without a server-side store, and there
isn't one. Cross-device *controls* (force-logout, suspension, project blocks)
do still work, because those go through `/api/controls`. And because the log
sits in the staff member's own browser, anyone who can open devtools can edit
or clear it; the append-only guarantee a server endpoint used to provide did
not survive the move into the tab.

### Tests

`npm test` runs the Vitest suite — the Sperto client's quirk handling (errors
on HTTP 200, JSON labelled `text/html`, api_key never echoed back out) and the
per-project time accounting that feeds Sperto's `project_time`.

## Layout

| Path | What it is |
|---|---|
| `index.html` | The single page. Loads the three Google Fonts the stylesheets name. |
| `src/main.jsx` | Entry point — Sentry, the top-level error boundary, the root render |
| `src/App.jsx` | The shell: router, plus the force-logout and idle-logout watchers |
| `src/routes/guards.jsx` | Who may see which screen — replaces the Next.js middleware |
| `src/pages/` | One component per route |
| `src/components/` | The screens themselves, each with its own CSS module |
| `src/lib/` | Browser-side: session, API clients, and the activity log itself (`activity-store.js`) |
| `src/data/properties.js` | Property list — the seam where the content API will plug in |
| `src/data/customers.js` | Dummy customer directory — the seam for the customer API |
| `server/app.js` | The API: mounts every route, optionally serves `dist/` |
| `server/index.js` | Starts it as a long-lived process (`npm start`, `npm run dev`) |
| `api/index.js` | The same app as one Vercel Serverless Function |
| `server/routes/` | One router per `/api` endpoint |
| `server/lib/` | Server-side only: the in-memory store, password hashing, Sperto, session tokens |
| `server/lib/sperto-response.js` | The one place a Sperto answer is read — see below |
| `scripts/docs/flow-pdf.cjs` | Builds `docs/Hiranandani-Flow.pdf` (`npm run docs:flow`) |

Two modules are deliberately shared across the boundary, and neither imports
anything: `src/lib/users.js` (the account roster, minus the password hashes,
which live in `server/lib/users.js`) and `src/lib/device-types.js`.

## Talking to Sperto

Their CRM does not use HTTP status codes to mean anything: a rejection comes
back **200**, and a real device-usage success has been seen coming back
**500**. So nothing here branches on the transport status — every answer is
read out of the body, in one place (`server/lib/sperto-response.js`), by both
the login check and the device-usage log.

That second one matters: the device-usage client used to discard the response
entirely, which meant a visit Sperto *refused* to store looked exactly like
one it stored. It now reports `recorded: true/false` and logs a failure with
Sperto's own words. It still answers `ok: true` either way — a presentation
must be free to start and end whether or not the CRM accepted the write.

On logout, the visit data goes out in **two** fields carrying the same
numbers: `page_url` as `[{ "Elena": 180 }, { "Alibaug": 240 }]` (their field,
always existed) and `project_time` as `{ "Elena": 180, "Alibaug": 240 }` (a
custom field their published API doesn't list). Whichever one they are actually reading has the
numbers in it. Full detail, and the open questions still outstanding with the
client, are in [docs/sperto.md](docs/sperto.md).

[docs/Hiranandani-Flow.pdf](docs/Hiranandani-Flow.pdf) is the same story for a
non-developer: the flow end to end, what reaches the CRM, how time is measured,
and what is still open with the client. Rebuild it with `npm run docs:flow`
whenever the flow changes, so it cannot drift from the code.

## Ported off Next.js

What the framework was doing, and what does it now:

| Was | Is |
|---|---|
| App Router pages under `src/app/**` | `react-router-dom` routes in `src/App.jsx` |
| `src/proxy.ts` middleware, verifying the session before a page is served | `src/routes/guards.jsx` + a new `GET /api/session` endpoint |
| Route handlers under `src/app/api/**` | Express routers under `server/routes/` |
| `next/font/google` | A `<link>` in `index.html`; the CSS variables are unchanged |
| `useRouter().push/replace/back` | `useNavigate()` |
| `global-error.tsx` | `src/ErrorFallback.jsx`, behind a Sentry error boundary |
| `@sentry/nextjs` | `@sentry/react` |
| `vercel.json` cron (nightly DB backup) | Gone with the database — there is nothing of ours left to back up |
| TypeScript types | Removed; shapes are described in the comment above each module |

**The one thing that genuinely changed.** Next.js verified the session token on
the server before a page was ever sent. A client-rendered app has no such step,
so `RequireAuth` asks the API instead (`GET /api/session`, which verifies the
same signed cookie) and renders nothing until it answers. It reads the verified
token, not the client-writable `futeservices_role` cookie — that one is still
display-only.

This is about showing the right person the right screen, not about security:
the pages are static files a browser can always fetch. The actual enforcement
is that every endpoint behind them checks the same cookie server-side
(`server/lib/viewer.js`), exactly as it did before.

**A small improvement taken along the way.** Under Next.js the password hashes
shipped in the browser bundle, because `users.ts` was imported by client code
for the "New Joiner" badge and the activity log's `actorFields`. The roster and
the hashes are now separate modules, and only the roster crosses to the client.

**Known lint warnings.** `npm run lint` reports ~23 warnings, all from rules
new in `eslint-plugin-react-hooks` v7 that the framework config didn't enforce
(`set-state-in-effect`, `purity`, `exhaustive-deps`). They fire on patterns
that predate the port and are deliberate — an effect reading
`window.location.search` once on mount, an interval ticking a clock,
`Date.now()` read while rendering a "how long ago" column. Each is worth
revisiting on its own terms; none was introduced here, so none fails the lint.

## How the carousel works

`PropertyCarousel` and `ShowroomCarousel` are not on any screen today — the
showcase moved to a rail over the VR tour — but both are kept, and this is how
they work.

Cards are laid out on a **coverflow arc**, not the closed prism ring the
original design used. One float, `position`, says which card is at the front
(`1.5` = midway between cards 1 and 2). Each card's offset from `position` —
wrapped so the arc loops endlessly — drives its transform: slid along X by
`SPACING`, pushed back by `DEPTH`, and turned away by `TILT`, then faded and
blurred with distance.

**Why not the design's ring:** on a ring of `n` cards the neighbours sit `360/n`
degrees away. At the design's seven cards that's 51° — close enough that three
cards read at once, which is the look. At three cards it's 120°, past the 90°
where `backface-visibility: hidden` hides a face, so only ever one card would be
visible. Widening the radius doesn't help; the problem is the angle. The arc
holds the intended look at any count.

One `requestAnimationFrame` loop owns `position` and writes the transforms.
It lives in a ref, not state, so the loop never re-renders React; only the active
index (counter + nav highlight) is state.

Interactions: drag to spin (the front card tracks the pointer 1:1 — that's why
drag divides by `SPACING`), arrow buttons and ←/→ keys step one card, the nav
list jumps the short way round. Any of these pause the auto-drift, which resumes
after 4s idle. `prefers-reduced-motion` disables auto-drift and snap transitions.

The stage is designed at `DESIGN_WIDTH` and scaled down uniformly on narrower
viewports, so the arc never crops.

## Not built yet

- Property data is hardcoded in `src/data/properties.js`; swap for the API.
- Floor plans have no media; `ImageSlot` renders a captioned placeholder.
- Sperto's real numeric `device_id` per device type is a placeholder mapping in
  `server/lib/sperto-device-usage.js`, and the custom `project_time` field on
  their device-usage endpoint is unconfirmed on their side.
