# Hiranandani Properties Showcase — Website

Next.js (App Router, TypeScript) implementation of the rotating carousel design
from Claude Design.

## Run

```bash
npm install
npm run dev      # http://localhost:3000
npm run build
```

## Deploy (Vercel)

The app lives in `web/`, not the repo root, so **Root Directory must be set to
`web`** in the Vercel project settings. That setting is what makes the deploy
work — it cannot be set from `vercel.json`, and without it the build fails with
"No Next.js version detected".

Importing the Hiranandani dashboard repo for the first time:

1. Vercel → Add New → Project → import the repo.
2. **Root Directory → Edit → select `web`.** Everything else auto-detects
   (framework Next.js, `next build`, output `.next`).
3. Deploy. No environment variables are needed yet — the property data is
   hardcoded and there's no API.

Pushes to `master` then deploy to production; other branches get preview URLs.

There is deliberately no `vercel.json` — Next.js needs no config on Vercel, and
Root Directory (the one thing that actually matters here) can only be set in the
project settings, not in that file.

**Symptom to recognise:** if the deploy succeeds but every URL returns
`404: NOT_FOUND`, Root Directory is wrong. Vercel found no framework at the repo
root, treated it as a plain static folder, and there's no `index.html` there to
serve.

## The sales staff flow

Four screens, in order:

1. **`/login`** — Sales ID + Customer ID, one step. Admin and sales managers
   sign in with email + password behind the "Admin / Manager login" link.
2. **`/session/start`** — the customer's details, looked up from the Customer
   ID typed on the login screen, then the device picker.
3. **`/dashboard`** — the 360° VR tour and property showcase.

There is no intro splash, no Earth transition and no separate customer-search
screen; the lookup is folded into the login.

## Dummy data, and where the real API plugs in

The staff flow runs end-to-end with **no database and no API credentials**.
Customer lookups fall back to `src/data/customers.ts`, a fixed list of five
customers (`LEAD-1001` … `LEAD-1005`, each also findable by phone number).

To wire up the client's real customer API, change **one file**: point
`findDummyCustomer` in `src/data/customers.ts` at the API, or delete the
fallback in `src/lib/leads.ts`'s `findLead` and let its existing `/api/leads`
call be the only path. Nothing else in the flow reads that file.

Test accounts: `admin@futeservices.com` / `admin123`,
`manager@futeservices.com` / `manager123`, and the staff accounts
`staff@futeservices.com`, `aditya@futeservices.com`,
`sneha@futeservices.com` (all `staff123`).

Staff sign in with **email and no password**: the email is checked against
Sperto, the client's CRM, and one they don't have is a rejection (see
[docs/sperto.md](docs/sperto.md)). Without `SPERTO_BASE_URL` and
`SPERTO_API_KEY` set, that check falls back to the staff accounts listed
above, so the flow still runs locally with no credentials at all.

The next screen asks for the **Lead ID** (or the customer's phone number) and
the device being presented on, then the showcase opens.

### Environment

| Variable | Needed for |
|---|---|
| `SESSION_SECRET` | Required. Signs the session cookie `proxy.ts` verifies. |
| `DATABASE_URL` | Optional for the demo. Required for the reporting dashboards. |
| `SPERTO_BASE_URL` | The CRM that verifies staff emails at login, and that logs device usage (see below). Unset locally. |
| `SPERTO_API_KEY` | Server-side only — never reaches the browser. Unset locally. |
| `SPERTO_DEVICE_USAGE_API_KEY` | Separate key for the device-usage log (`docs/sperto.md`'s second integration). Server-side only. |
| `CRON_SECRET` | Authorises `/api/cron/*`. Vercel sets this itself. |

Optional: `SPERTO_TIMEOUT_MS` (default 8000).

### Tests

`npm test` runs the Vitest suite — the Sperto client's quirk handling (errors
on HTTP 200, JSON labelled `text/html`, api_key never echoed back out).

## Layout

| Path | What it is |
|---|---|
| `src/app/page.tsx` | Home page — server component, passes property data to the carousel |
| `src/components/PropertyCarousel.tsx` | The 3D carousel (client component) |
| `src/components/ImageSlot.tsx` | Image placeholder; takes a real `src` once media storage lands |
| `src/data/properties.ts` | Property list — the seam where the API will plug in (TRD §2) |

## How the carousel works

Cards are laid out on a **coverflow arc**, not the closed prism ring the original
design used. One float, `position`, says which card is at the front (`1.5` = midway
between cards 1 and 2). Each card's offset from `position` — wrapped so the arc
loops endlessly — drives its transform: slid along X by `SPACING`, pushed back by
`DEPTH`, and turned away by `TILT`, then faded and blurred with distance.

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

- Property data is hardcoded in `src/data/properties.ts`; swap for the API.
- `href` on every property is `#` — needs the real external site URLs (PRD §2).
- Cards have no images; `ImageSlot` renders a captioned placeholder until then.
