<div align="center">

![cancri — live-portfolio-terminal](assets/cancri-banner.png)

### `// live-portfolio-terminal`

**a terminal you leave open.** colour and motion carry information — direction, freshness, activity — never decoration. and the terminal always tells the truth about its own data: <span>`LIVE`</span> vs <span>`DELAYED`</span> is never hidden.

[![CI](https://github.com/t11z/cancri/actions/workflows/ci.yml/badge.svg)](https://github.com/t11z/cancri/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/docs-github%20pages-5ec6ff)](https://t11z.github.io/cancri/)
[![ADRs](https://img.shields.io/badge/decisions-smADR-7b5cff)](docs/decisions/)
[![License: MIT](https://img.shields.io/badge/license-MIT-36f9d0)](LICENSE)
![Node](https://img.shields.io/badge/node-26-5ec6ff)
![TypeScript](https://img.shields.io/badge/typescript-strict-5ec6ff)

</div>

```
[ok]  cancri // live-portfolio-terminal — online
[net] establishing socket → primary feed — handshake
[net] subscribing instruments · L1 quotes
[llm] gemini intake channel ready
[ok]  freshness monitor armed · live/delayed
[ok]  terminal ready ✓
```

---

## what it is

cancri is an **access-gated, real-time web terminal** that streams *your own* portfolio at cent-level latency. you describe your holdings in plain language (or drop a CSV/Excel), an LLM reads them into a confirmed inventory, and a live data layer keeps the numbers moving — flashing green up, red down, with a sparkline that draws itself on every tick.

it is **read-only**. no orders, no trading. just the truth about your book, beautifully.

> **the machine proposes — you dispose.** nothing streams until you confirm your inventory. and the self-healing data layer opens a *pull request* when the upstream protocol changes — it never merges itself.

## the principles

| principle | what it means |
|---|---|
| 🟢 **colour = meaning** | up is `▲ +` in mint, down is `▼ −` in rose. direction is never colour-only. |
| ⚡ **freshness is honest** | `LIVE` (mint, calm breathing pulse) vs `DELAYED` (amber, off-beat) — by colour *and* rhythm *and* text. |
| 🌗 **honesty over blackout** | when the primary feed dies, the dashboard doesn't go dark — it flips to the delayed fallback and *says so*. |
| 🔒 **secrets stay server-side** | the client only ever subscribes to normalised ticks. no source internals, no keys. |
| 🤖 **propose, don't dispose** | the LLM proposes an inventory; the self-heal proposes a PR. a human always confirms. |

## architecture

```
                         ┌──────────────────── browser (Firebase Hosting) ───────────────────┐
                         │  vanilla-TS terminal · single rAF loop · subscribes to ticks only  │
                         └───────▲───────────────────────────▲───────────────────────────────┘
              read /quotes,/feed │ (RTDB)         callable    │ Auth + Firestore (the book)
                                 │                            │
   ┌──────────── Realtime Database ─────────┐    ┌──────── Cloud Functions (2nd gen) ────────┐
   │  /quotes/{isin}   ·   /feed/status      │    │  normalizeInventory · confirmInventory     │
   │  (public-to-signed-in, client read-only)│    │  logo · (Gemini via Vertex AI, IAM)        │
   └──────────────▲──────────────────────────┘    └────────────────────────────────────────────┘
   sole writer    │ (Admin SDK)
   ┌──────────────┴──────── Cloud Run: feed-engine (always-on) ──────────────┐
   │  FeedManager · SanityOracle · degradation FSM                            │
   │  ┌── L&S (primary, real-time) ──┐   ┌── Yahoo (fallback + oracle) ──┐    │
   │  │  ls-protocol (the break       │   │  protobuf · venue suffixes    │    │
   │  │  surface — versioned config)  │   │  always freshness:delayed     │    │
   │  └───────────────────────────────┘   └───────────────────────────────┘    │
   └──────────────────────────────────────────────────────────────────────────┘
              ▲ when the undocumented L&S protocol changes…
   ┌──────────┴──── Cloud Run Job: self-heal ────────────────────────────────┐
   │  Playwright captures raw frames + the rendered price (ground truth) →     │
   │  deterministic replay finds the fix → opens a reviewable PR. no auto-merge.│
   └──────────────────────────────────────────────────────────────────────────┘
```

every architecture decision is recorded as a [Structured MADR](docs/decisions/) (ADR-0001 … ADR-0011).

## monorepo

```
apps/web/                  the terminal SPA (Vite, vanilla TS, single rAF loop)
services/feed-engine/      always-on Cloud Run: L&S + Yahoo taps, oracle, FSM, sole RTDB writer
services/selfheal/         Cloud Run Job: capture-and-diff → gated PR
functions/                 Gemini intake/confirm + logo (Vertex AI, IAM, no keys)
packages/data-contracts/   the one shared seam: Tick, SourceAdapter, inventory schema
packages/ls-protocol/      the L&S break surface + deterministic replay (the self-heal target)
packages/selfheal-core/    pure fix-search + replay gate + fixture corpus
packages/sim-source/       in-browser mock feed (drives local dev with zero backend)
tools/tokens/              design tokens generated from design/cancri.handover.json
config/                    firestore.rules · database.rules.json · indexes
design/                    the Claude Design handover — source of truth for all UI
```

## quickstart

> **no Node on your machine?** good — you don't need it. everything runs in Docker.
> (host needs Docker; the helper scripts use a `node:26` container.)

```bash
# one-shot: checks Docker, then boots the terminal (mock feed, no backend, no secrets)
scripts/quickstart.sh    # → http://localhost:5173

# or the plain dev server / a full typecheck + production build
scripts/dev.sh           # → http://localhost:5173
scripts/build.sh         # typecheck every package + build the web app
```

the dev build ships a `// review` bar (dev-only) to jump between every screen and dashboard
state — boot · auth · onboard · confirm · dash, and live / degraded / reconnect / closed / empty / error.

want the full Firebase emulator suite (auth + firestore + database + functions)? see
[`SETUP.md`](SETUP.md). want to deploy? `scripts/deploy.sh` does a one-shot manual Firebase
push, and [`deploy.yml`](.github/workflows/deploy.yml) is the keyless CI pipeline — both
documented on the [docs site](https://t11z.github.io/cancri/deploy.html).

## documentation

full user + maintainer docs — in cancri's own optics — live at
**[t11z.github.io/cancri](https://t11z.github.io/cancri/)** (source in [`site/`](site/), published by
[`pages.yml`](.github/workflows/pages.yml)):
[quickstart](https://t11z.github.io/cancri/quickstart.html) ·
[usage](https://t11z.github.io/cancri/usage.html) ·
[contributing](https://t11z.github.io/cancri/contributing.html) ·
[deploy](https://t11z.github.io/cancri/deploy.html) ·
[maintaining](https://t11z.github.io/cancri/maintaining.html).

## stack

current-stable, pinned, supply-chain-conscious (SHA-pinned actions, `allowBuilds` approvals):

`Node 26` · `pnpm 11` · `TypeScript 6` (strict) · `Vite 8` · `Firebase` (Hosting/Auth/Firestore/RTDB/Functions/Cloud Run) · `Gemini 3.5 Flash` via Vertex AI · `protobufjs` · `Playwright` (self-heal) · `vitest`.

## status

the **2-of-2 implementation is complete** — all seven phases built and verified (typecheck +
unit + emulator), each its own reviewed PR:

| phase | what | verified by |
|---|---|---|
| 1 | terminal UI | typecheck + prod build |
| 2 | auth + per-user persistence + isolation rules | emulator (rules + persistence) |
| 3 | Gemini intake + onboarding | functions-emulator E2E |
| 4 | feed-engine + RTDB tick bus | RTDB transport E2E |
| 5 | Yahoo fallback + sanity oracle + degradation FSM | unit |
| 6 | self-heal core + replay gate + CI gate | unit |
| 7 | logo + WIF deploy + real CI | emulator + unit |

**flagged for the live world** (needs accounts / live sources, clearly inert in code):
the real Vertex call · the L&S/Yahoo live sockets · the Playwright capture + GitHub-App PR ·
Cloud Run images + WIF provisioning · a logo provider. see [`SETUP.md`](SETUP.md) for the runway.

## contributing

PRs welcome — start with [`CONTRIBUTING.md`](CONTRIBUTING.md). the short version: artifacts in
English, architecture decisions go in [`docs/decisions/`](docs/decisions/) as smADRs, and the
machine proposes while you dispose.

## license

[MIT](LICENSE) © Thomas Sprock

<div align="center"><sub><code>booting… → mounting workspace…</code> ▮</sub></div>
