# Security Policy

cancri handles per-user financial data and rides undocumented upstream protocols, so we take
security seriously and welcome responsible disclosure.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Use GitHub's **private vulnerability reporting**:
[Security → Report a vulnerability](https://github.com/t11z/cancri/security/advisories/new).

Please include: affected component (web / functions / feed-engine / self-heal / rules), a
description, reproduction steps, and the impact you observed. We aim to acknowledge within a
few days and to keep you updated through to a fix.

## Scope & design notes

- **Per-user isolation** is enforced by Firestore security rules (`config/firestore.rules`),
  proven by an emulator test suite. Cross-user reads/writes and unauthenticated access are
  denied by default.
- **The client only reads.** Prices live in Realtime Database as a public-to-signed-in
  resource; private holdings are uid-scoped in Firestore. The feed-engine is the sole writer.
- **No secrets in the client.** Gemini runs server-side on Vertex AI via service-account IAM
  (no API key). L&S handshake config lives in Secret Manager. CI authenticates via OAuth /
  Workload Identity Federation — no long-lived keys.
- **Self-heal never auto-merges.** A protocol fix is proposed as a reviewable PR, gated by a
  deterministic replay regression and a bounded-surface check; a human merges.

## Known posture (by design, accepted trade-offs)

- The L&S and Yahoo feeds are public-but-undocumented endpoints; access is a deliberate,
  read-only product posture, not a vulnerability.
- The deterministic FP-filtering on the CI security review is intentional (the AI filter
  needs an API key cancri does not use).
