# Contributing to cancri

```
> welcome. the machine proposes — you dispose.
```

Thanks for wanting to hack on cancri. This is a read-only live-portfolio terminal with a
strong point of view: **colour and motion carry meaning, the terminal is honest about its
data, and humans confirm everything.** Contributions that respect that ethos are very welcome.

## Ground rules

- **Repository artifacts are English** (code, comments, commits, PRs, docs, ADRs). Chat with
  the maintainer happens in their language; the repo speaks English.
- **Architecture decisions go in [`docs/decisions/`](docs/decisions/) as smADRs** — not in
  code comments or this file. A decision needs an ADR when it is hard to reverse, spans
  layers / a public interface / a contract, pins a provider or stack building block, or
  displaces a plausible alternative worth recording. When unsure, open one in `proposed`
  status (run `/adr-new` in Claude Code, or copy `docs/decisions/adr-template.md`).
- **No secrets, ever.** Source access and all key-touching calls run server-side. The client
  only subscribes to normalised ticks. Never commit `.env`, keys, or tokens.
- **Propose, don't dispose.** No silent adoption, no auto-merge — for the LLM inventory and
  for the self-heal PR alike.

## Dev setup — no Node on your host required

Everything runs in Docker (a `node:26` container); the host only needs Docker.

```bash
scripts/dev.sh      # run the terminal locally with a mock feed → http://localhost:5173
scripts/build.sh    # typecheck every package + production-build the web app
```

The local dev build has a dev-only `// review` bar to jump between every screen and dashboard
state. No Firebase project, no secrets needed.

For the full Firebase emulator suite (auth + firestore + database + functions) and the
end-to-end tests, see [`SETUP.md`](SETUP.md).

## Tests

Each package has a `vitest` suite. The security rules, persistence, and tick-bus run against
the Firebase Emulator Suite (needs a JDK; the containerised flow handles it). CI runs:

- **CI / verify** — typecheck (all) + web build + non-emulator unit tests.
- **CI / rules** — security rules + persistence + tick-bus on the emulators.
- **Validate ADRs** — smADR schema check on `docs/decisions/`.
- **ls protocol replay regression** — the self-heal merge gate (and bounded-surface check).
- **Security Review** — OAuth-authenticated review of the diff.

Please keep PRs green.

## Branching & PRs

- **Branch off `main`** and open the PR against `main`. Don't stack PRs on each other — a
  merge lands in the PR's *base*, so stacked bases never reach `main`.
- Conventional-commit-ish titles (`feat(...)`, `fix(...)`, `docs(...)`, `chore(...)`).
- Fill the PR template's **Architecture impact** checklist honestly.
- For security-relevant changes, run `/security-review` locally before pushing.

## Code style

- **TypeScript, strict.** No `any` — use `unknown` + a guard or a concrete type. Honour the
  shared `tsconfig.base.json` (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`, …).
- **The `design/` handover is the source of truth for everything visual.** UI tokens are
  generated from `design/cancri.handover.json` — never hand-edit the generated files.
- **The `data-contracts` package is the only seam** between client and server. Nothing
  source-specific (Lightstreamer frames, protobuf, internal ids) may cross it.
- Match the style of the surrounding code; keep diffs minimal and focused.

## Good first contributions

- A **logo provider** behind `resolveLogo`'s injected fetcher (`functions/src/logo.ts`).
- More **fixtures** for the L&S protocol corpus / additional decode edge cases.
- **Accessibility** passes on the terminal UI (focus order, reduced-motion parity).
- **Yahoo venue** coverage and `PricingData` schema hardening.

By contributing you agree to the [Code of Conduct](CODE_OF_CONDUCT.md) and that your work is
licensed under the [MIT License](LICENSE).
