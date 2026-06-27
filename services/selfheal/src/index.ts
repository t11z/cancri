import { PROTOCOL_CONFIG_V1 } from "@cancri/ls-protocol";
import {
  fixturePath,
  searchProtocolFix,
  serializeFixture,
  type CapturedFixture,
} from "@cancri/selfheal-core";

/**
 * Self-heal Cloud Run Job (brief §D, ADR-0010). The pure pieces — fix search,
 * replay gate, corpus serialization — come from @cancri/selfheal-core and are
 * fully tested. The two impure steps below are FLAGGED scaffolds: they need a live
 * browser and the GitHub App and are inert until wired at runtime (Phase 6).
 */

/**
 * Capture-and-diff: a real (Playwright) browser drives the live ls-tc.de page
 * during trading hours, records the raw protocol frames AND scrapes the
 * simultaneously-rendered price — ground truth from the same source, same moment.
 */
async function captureFromLivePage(): Promise<CapturedFixture> {
  throw new Error("capture not implemented: needs Playwright + live ls-tc.de (Phase 6 runtime)");
}

/**
 * Open a reviewable PR (GitHub App) with the proposed config + the fixture as
 * evidence, on a `selfheal/*` branch. No auto-merge — a human merges; the replay
 * regression + bounded-surface checks gate it.
 */
async function openSelfHealPr(_files: ReadonlyArray<{ path: string; content: string }>): Promise<void> {
  throw new Error("PR open not implemented: needs the GitHub App token (Phase 6 runtime)");
}

export async function runSelfHeal(): Promise<void> {
  const captured = await captureFromLivePage();
  const fix = searchProtocolFix(PROTOCOL_CONFIG_V1, captured);

  if (fix === null) {
    // The break exceeds the bounded surface — escalate to a human-reviewed
    // `@claude implement` rather than guessing. Nothing auto-changes.
    return;
  }

  await openSelfHealPr([
    { path: fixturePath(captured.capturedAt), content: serializeFixture(captured) },
    // + the bumped protocol.config.<v> carrying `fix` (the actual change).
  ]);
}
