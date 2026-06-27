# Architecture Decision Records

This directory holds Architecture Decision Records (ADRs) in [Structured MADR](https://smadr.dev/) format. They are validated in CI by `.github/workflows/adr-validate.yml`.

## When to write an ADR

Write one when a decision:

- is hard to reverse, or
- spans multiple layers, a public interface, or a contract, or
- pins an invariant, a provider, or a stack building block, or
- displaces a plausible alternative worth recording.

Do **not** write one for implementation details, local refactors, naming, helper structures, or test layout. When unsure, open one in `proposed` status.

## File naming

`{NNNN}-{slug}.md`, zero-padded sequential number — e.g. `0001-use-postgresql-for-primary-storage.md`. Copy `adr-template.md` as the starting point, or run `/adr-new`.

## Lifecycle

`proposed` → `accepted` → (`deprecated` | `superseded`)

ADRs are **append-only**. Once `accepted`, the body is immutable. To change a decision, write a new ADR and link them via `supersedes` / `superseded_by`.

## Required sections

Frontmatter (title, description, type, category, tags, status, created, updated, author, project) plus body sections Status, Context, Decision Drivers, Considered Options (with per-option risk assessment), Decision, Consequences, Decision Outcome, and a mandatory Audit section. The full schema is enforced by the validator.

## Index

| ID | Title | Status |
|----|-------|--------|
| [0001](0001-pin-region-europe-west3.md) | Pin all Firebase/GCP resources to europe-west3 (Frankfurt) | accepted |
| [0002](0002-three-runtime-classes-execution-model.md) | Three runtime classes: Functions, always-on Cloud Run, browser Job | accepted |
| [0003](0003-feed-engine-single-process-singleton.md) | One feed-engine process owns both sources; singleton, no HA initially | accepted |
| [0004](0004-datastore-split-firestore-book-rtdb-wire.md) | Firestore is the book; Realtime Database is the wire | accepted |
| [0005](0005-realtime-transport-rtdb-tick-bus.md) | Clients consume ticks via RTDB, not a direct Cloud Run socket | accepted |
| [0006](0006-tick-schema-and-source-adapter-contract.md) | Shared Tick schema + SourceAdapter interface in data-contracts | accepted |
| [0007](0007-isin-resolution-llm-proposes-resolver-disposes.md) | ISIN is canonical; LLM proposes identity, deterministic resolver disposes | accepted |
| [0008](0008-gemini-vertex-iam-callable.md) | Gemini via Vertex AI from a Callable Function using service-account IAM | accepted |
| [0009](0009-ls-protocol-break-surface-isolation.md) | Quarantine the L&S break surface in a versioned ls-protocol module | accepted |
| [0010](0010-self-heal-governance-pr-deterministic-gate.md) | Self-heal: App-authored PR gated by offline deterministic replay, no auto-merge | accepted |
| [0011](0011-frontend-vanilla-ts-vite-single-raf.md) | Frontend is vanilla TS + Vite with a single rAF loop and two-tier state | accepted |
