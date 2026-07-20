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
