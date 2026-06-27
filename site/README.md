# cancri docs site

The published documentation for cancri — user **and** maintainer docs — in cancri's own optics
(the design tokens from `design/cancri.handover.json`, mirrored in `assets/cancri.css`).

Live at **https://t11z.github.io/cancri/**.

## What's here

| Page | Audience | Covers |
|------|----------|--------|
| `index.html` | everyone | overview, principles, architecture at a glance |
| `quickstart.html` | user | **1 · set it up** — one-shot local run, the review bar, the emulator suite |
| `usage.html` | user | **2 · use it** — sign in, onboard, confirm, read the dashboard, freshness, states |
| `contributing.html` | contributor | **3 · contribute** — dev loop, tests, the smADR ritual, branching, style |
| `deploy.html` | maintainer | deploy to Firebase — manual one-shot + keyless CI, the going-live runway |
| `maintaining.html` | maintainer | architecture, data layer, self-heal governance, CI gates, the decision record |

## Authoring

Hand-authored static HTML/CSS/JS — **no build step**. Edit the files directly.

- `assets/cancri.css` — the design system. Tokens mirror the handover; keep them in lockstep.
- `assets/site.js` — small behaviours (live ET clock, boot stagger, copy buttons, mobile nav, TOC tracking).
- Links are **relative** so the site works under the `/cancri/` Pages subpath.
- `.nojekyll` disables Jekyll processing on Pages.

## Preview locally

```bash
cd site && python3 -m http.server 8080   # → http://localhost:8080
```

## Publish

Pushing to `main` with changes under `site/` triggers `.github/workflows/pages.yml`, which uploads
this folder and deploys it to GitHub Pages. One-time setup: repo **Settings → Pages → Source =
“GitHub Actions.”**
