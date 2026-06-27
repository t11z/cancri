# CLAUDE.md

> Behaviour, conventions, and wayfinding for this repository.
> This file never duplicates architecture decisions or other volatile facts — those live in `docs/decisions/` as smADRs. Keep this file from becoming a maintenance burden.

## Project

`cancri` — a **live-portfolio-terminal**: an access-gated, real-time web terminal that streams a user's own portfolio at cent-level latency. "A terminal you leave open" — colour and motion carry information (direction, freshness, activity), never decoration, and the terminal is always honest about whether its data is live or delayed.

Shape of the system:

- **Read-only.** It displays positions and live prices. No orders, no trading.
- **Per-user and access-gated.** Firebase Auth gates entry; each user sees only their own book, enforced by the datastore's security rules.
- **Onboarding via Gemini.** Users describe their portfolio in chat or drop a CSV / XLSX / pasted text; Gemini normalises messy input into a structured inventory keyed on **ISIN/symbol**. The machine proposes, the user disposes — nothing streams until the user confirms.
- **Live price data layer (built from scratch).** A source-agnostic adapter interface delivers normalised ticks. Primary source: **L&S** (ls-tc.de, real-time, cent-accurate, undocumented Lightstreamer-6 protocol). Fallback: **Yahoo** (delayed ~15 min, also the runtime sanity oracle). On primary loss the layer auto-degrades to the fallback and marks data `delayed` rather than going dark.
- **Self-healing primary source.** A scheduled probe watches L&S for liveness and price sanity; on a sustained break, a real browser captures raw protocol frames alongside the simultaneously-rendered price (ground truth), diffs against the known protocol, and opens a **reviewable PR** with frame/price fixtures. No auto-merge — a human merges. Fixtures accrete append-only as protocol documentation and a regression corpus.
- **Server-side secrets.** All source access and Gemini calls run server-side inside Firebase; the client only ever subscribes to normalised ticks.

Platform constraints (fixed): Firebase Hosting · Firebase Auth · Gemini · data stays inside the Firebase project. Everything visual, interactive, and animated is governed by the design handover in `design/` (the source of truth for UI). Concrete technology choices that fix the direction are recorded as ADRs under `docs/decisions/`, not here.

## Design handover

`design/` holds the imported Claude Design handover — the **source of truth for everything visual, interactive, and animated** (tokens, components, motion, microcopy). On any UI conflict, the handover wins; for behaviour and data contracts, the implementation brief wins. See `design/README.md`.

## Language regime

- Conversation with the architect: in the architect's language.
- Repository artifacts (code comments, documentation, issues, pull requests, commit messages, ADRs, this file): **English**, consistently.

## Architecture decisions

Architecture lives in `docs/decisions/` as Structured MADR (smADR). Write an ADR when a decision:

- is hard to reverse, or
- spans multiple layers, a public interface, or a contract, or
- pins an invariant, a provider, or a stack building block, or
- displaces a plausible alternative worth recording.

Do **not** write an ADR for implementation details, local refactors, naming, helper structures, or test layout — those are settled in code review and, where stable, captured here.

When unsure, open an ADR in `proposed` status. ADRs are append-only: once `accepted`, supersede instead of editing.

## Authentication

This project authenticates Claude tooling via `CLAUDE_CODE_OAUTH_TOKEN`, never `ANTHROPIC_API_KEY`. See `SETUP.md` for secret setup.

## Conventions

- Keep changes minimal and reviewable: prefer the smallest diff that solves the problem, and match the style of the surrounding code.
- Never commit secrets. Use environment variables or a secret manager; keep `.env` gitignored and document placeholders in `.env.example`.

## Wayfinding

- `docs/decisions/` — architecture decision records (smADR). Start at `docs/decisions/README.md`.
- `.claude/commands/` — slash commands: `/adr-new`, `/security-review`.
- `.claude/agents/` — subagents: `adr-author`, `security-reviewer`.
- `.github/workflows/` — CI, smADR validation, security review, issue triage.
- Subdirectory `CLAUDE.md` files carry conventions specific to that part of the code (added once code lands).
