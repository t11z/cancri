# Design handover — source of truth for UI

This folder is the **imported Claude Design handover** for cancri. It is the source of
truth for everything **visual, interactive, and animated**. On any UI conflict the
handover wins; for behaviour and data contracts, `IMPLEMENTATION_BRIEF.md` wins.

## Contents

| File | What it is |
|------|------------|
| `cancri.handover.json` | Structured spec: design tokens (colour, type, spacing, motion), every component with states + data contracts, the motion spec, microcopy, asset specs, accessibility rules, and derivation formulas. **Read this first.** |
| `Cancri-Terminal.reference.dc.html` | The interactive reference build (all screens + secondary states). Authored in Claude Design's `DCLogic` template format — **not** our runtime. Use it as the pixel/markup/motion ground-truth: exact inline styles, grid templates, sparkline math, rAF tween factors, flash decay, pulse rhythms. Re-implement its behaviour in the chosen framework; do not ship `.dc.html` or `support.js`. |
| `IMPLEMENTATION_BRIEF.md` | The functional/interface brief (the "what" and the contracts). Behaviour and data authority. |

Not imported (they live in the Claude Design project `f27c6919-11c3-4042-a1de-1bae59ec7249`):
`screenshots/dash.png` (a rendered dashboard screenshot) and `support.js` (the Claude
Design runtime — irrelevant to our stack).

## How to read the reference

`{{ … }}` are DCLogic template bindings; `<sc-if>` / `<sc-for>` are its conditional and
loop primitives. The `<script type="text/x-dc">` block at the bottom holds the component
logic (seed data, boot timing, the live-tick simulation, number-roll tween, sparkline
projection, flash decay). The seed data and 1s tick loop are a **simulation** for the
design — real data comes from the live data layer described in the brief.

## Token quick reference

- Ground `#05070b`, panels `#0b0f16` / `#0d121b`, borders `#1a2130` / `#222b3b`.
- Meaningful accents only: up/LIVE `#36f9d0`, down `#ff5277`, brand/LLM/source `#7b5cff`,
  DELAYED/degraded/flag `#ffd23f`, symbols/user/file-types `#5ec6ff`.
- Everything monospace (JetBrains Mono), `tabular-nums` on every numeric cell.
- Direction and freshness are **never colour-only** — always arrow+sign and text+rhythm too.
