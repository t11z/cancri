# Implementation brief — cancri (live-portfolio-terminal)

> Step 2 of 2 (implementation), following Claude Design. The **design handover** is the
> source of truth for everything visual/interactive/animated; this brief defines
> functionality and interfaces. On UI conflicts the handover wins; for behaviour/data,
> this brief wins. Implementation decomposition, build order, modules, frameworks, and
> tooling are the implementer's call.

## 1. Platform (fixed)

- **Hosting:** Firebase Hosting.
- **Auth:** Firebase Auth. Access-gated; each user sees only their own data.
- **LLM:** Gemini.
- **Data:** stays inside the Firebase project (product choice is open).

Open to choose: frontend framework, charting, animation/terminal-UI technique, logo
source, server-side execution mechanism within Firebase, state management, repo
structure, CI. Pick what fits the handover and the functionality.

## 2. Scope

### A. Authentication
Firebase Auth. Per-user data isolation via the datastore's security rules. No access to
other users' portfolios.

### B. Portfolio onboarding pipeline
- **Input channels:** (1) text chat with Gemini, (2) file/text import — CSV, Excel,
  pasted raw text. Both converge on the same normalisation step.
- **Normalisation by Gemini:** messy input → structured asset inventory on a fixed
  schema. Per position at minimum: original free-text name, **resolved instrument
  identity (ISIN/symbol)**, quantity, optional cost basis, and a confidence/uncertainty
  signal.
- **Identity resolution:** from free text or an ISIN to an identifier the live data layer
  can subscribe to. **ISIN is the central key** because the live layer maps ISIN → internal
  instrument id. On ambiguity, do not guess — ask the user.
- **Confirmation (propose/approve):** the proposed inventory is shown to the user for
  correction and confirmation before adoption. The LLM proposes, the user disposes
  (the confirm screen in the handover).
- **Persistence:** the confirmed inventory is stored per user in the Firebase datastore
  and survives sessions.

### C. Live price data layer (build the whole thing)
Build the full data layer — source connection, abstraction, and delivery.

- **Source adapter interface:** a source-agnostic abstraction pushing normalised ticks:
  `identity`, `lastPrice`, day change (absolute/percent), `timestamp`, `source`,
  `freshness` (`live` | `delayed`). The app subscribes only against this interface and
  never knows the concrete source.
- **Primary source (truly live, cent-accurate): L&S** via the public ls-tc.de push.
  Build this tap. Known facts: Appendix A.
- **Fallback (delayed): Yahoo** via its public WebSocket. Build this too. It serves
  double duty: degradation fallback **and** runtime sanity oracle (section D).
  Facts: Appendix B.
- **Automatic degradation:** if the primary fails, the layer switches itself to the
  fallback and reports `freshness: delayed`. The dashboard stays visible and is marked
  delayed instead of going dark.
- **ISIN→instrument-id mapping** lives in this layer (for L&S via its instrument search
  endpoint).
- **Server-side:** source logic and any credentials run server-side (mechanism of choice
  within Firebase). The client only subscribes to normalised ticks; no source internals
  or secrets in the client.

### D. Self-healing maintenance of the primary source
The L&S tap rides an undocumented protocol and breaks if the source changes it. Build the
mechanism that detects this and proposes a fix.

- **Probe (scheduled, trading-hours-aware):** regularly checks **liveness** (does a
  well-formed tick arrive within N seconds) and **sanity** (is the price within X% of the
  independent reference = Yahoo). Two modes: a lightweight frequent probe; a heavy
  capture-and-diff that fires **only** after several consecutive probe failures.
- **On break — capture-and-diff:** a real browser drives the live page during trading
  hours, records the raw protocol frames, and **simultaneously scrapes the correct price
  rendered on the page**. That pair (raw frame + simultaneously rendered price) is ground
  truth from the same source, same moment, no delay. Diff it against the known protocol
  and propose a fix for handshake / frame-decode / id-mapping.
- **Verification — deterministic:** the proposed parser is correct iff it reproduces the
  rendered prices from the recorded raw frames. That is an offline-replayable regression
  against real fixtures — the browser oracles the fix itself. Yahoo does **not** verify the
  fix; Yahoo stays runtime oracle and fallback.
- **Output — propose/approve:** the mechanism opens a reviewable pull request with the
  frame/price fixtures as evidence. **No auto-merge.** A human merges. The agent proposes,
  the human disposes.
- **Fixture corpus:** every landed fix snapshots the new working frames plus expected
  price append-only into a corpus. That corpus is both protocol documentation by example
  and the regression base.
- **Bounded break surface:** the fix target is limited to handshake parameters, frame
  decode, and id-mapping (see Appendix A).

### E. Logo asset pipeline
- Input: asset identity (name/domain/ISIN). Output: a stable logo reference or a fallback
  signal.
- **Server-side** fetch the logo from the network, **cache** it, deliver to the client.
  Logo source is open.
- **Fallback:** if no logo is found, signal the monogram fallback per the handover; the
  client renders the generated monogram tile.

### F. Realtime UI
- Tick subscription driving the handover's animations (tick flash, number transition,
  sparkline live draw).
- Render freshness/source status (live vs delayed) per the handover.
- Secondary states: reconnect, degraded, market closed, error, empty.

### G. Persistence & sessions
Confirmed inventory persists per user across sessions. Multiple portfolios per user are
optional and can follow later.

## 3. Governance & security

- **Propose/approve** at two points: inventory normalisation (LLM proposes, user disposes)
  and the self-healing fix (agent proposes a PR, a human merges). No silent adoption, no
  auto-merge.
- **Access control & per-user isolation** via security rules.
- **No secrets in the client:** source access and all key-touching Gemini calls run
  server-side.
- **Auditability:** the append-only fixture corpus is the data layer's audit trail;
  keeping inventory changes traceable is desirable.

## 4. Non-goals

- No order execution, no trading — the display is **read-only**.
- No new design decisions — those come from the handover.

## 5. Acceptance criteria

- Firebase Auth sign-in works; other users' portfolios are unreachable.
- All four input paths (chat, CSV, Excel, raw text) lead to a confirmable inventory.
- Gemini resolves positions to ISIN/symbol; ambiguities are asked back; the user can
  correct before adoption.
- The app gets prices exclusively through the source adapter interface.
- Primary L&S delivers truly live ticks; on failure the layer switches itself to the
  delayed Yahoo fallback and marks it visibly, without going dark.
- The probe detects a primary-source break and triggers degradation; on a sustained break
  capture-and-diff produces a PR with frame/price fixtures.
- The self-healing fix is gated by the deterministic regression against recorded frames;
  no auto-merge.
- Live ticks render with directional tick-flash and number transition per the handover.
- Logos load with monogram fallback per the handover.
- Inventory survives sessions.
- Source logic and secrets are server-side; the client only receives normalised ticks.
- Visual result and motion match the handover.

## Appendix A — Known facts about primary source L&S (context, not a recipe)

- Public push via ls-tc.de; **no documented API**. The source uses "Lightstreamer 6", a
  deprecated, undocumented legacy version. Only a browser-resident JS client exists.
- Session setup via a `create_session` endpoint with a "phase". Known sensitive params: a
  client-identification magic value (`LS_cid`), an adapter set (`WALLSTREETONLINE`), and
  polling/idle params.
- Connection sensitivities: required subprotocol and required origin
  (`https://www.ls-tc.de`); certain bytes at a fixed frame position must be set; line
  ending must be `\r\n`. Standard WebSocket clients don't always set these automatically.
- **ISIN→internal instrument id:** L&S uses different ids internally. Resolve via the
  source's instrument search endpoint by ISIN.
- Only the latest tick comes over the socket — **no history**.
- A community Python reimplementation exists as reference
  (`VIEWVIEWVIEW/Lightstreamer-6.1-python`).
- **Break surface** (what flips on a protocol change): handshake params (session creation,
  magic value, adapter set), frame byte offsets / line ending, id remapping. Exactly the
  bounded fix target of the self-healing.

## Appendix B — Known facts about fallback Yahoo (context, not a recipe)

- Public push via `wss://streamer.finance.yahoo.com/`, protobuf-encoded. Ready-made
  reference libraries exist (`yliveticker`, `yflive`) with auto-reconnect/heartbeat.
- German equities via exchange suffixes: `.DE` (Xetra), `.HM` (Hamburg ≈ LS environment),
  `.SG` (Stuttgart), `.F` (Frankfurt), `.MU`, `.DU`, `.BE`.
- For German venues quotes are mostly **delayed** (typically ~15 min). Hence fallback and
  sanity oracle, not primary display.
