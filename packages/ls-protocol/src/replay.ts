import type { DecodedUpdate, ProtocolConfig } from "./types.js";
import { makeProtocolModule } from "./index.js";

/**
 * Deterministic replay — the verification primitive behind the self-heal gate
 * (ADR-0010). A fixture pairs raw frames captured from the live socket with the
 * prices simultaneously rendered on the page. A protocol config is correct iff
 * replaying its decode over the recorded frames reproduces those prices. This is
 * offline and pure — no socket, no browser — so it runs identically in the
 * capture Job and in CI.
 */
export interface ProtocolFixture {
  readonly config: ProtocolConfig;
  readonly frames: readonly string[];
  readonly expected: ReadonlyArray<{ id: string; price: number }>;
}

export function replay(config: ProtocolConfig, frames: readonly string[]): DecodedUpdate[] {
  const module = makeProtocolModule(config);
  const out: DecodedUpdate[] = [];
  for (const frame of frames) {
    const update = module.decodeFrame(frame);
    if (update !== null) out.push(update);
  }
  return out;
}

/** The gate: does this config reproduce the rendered prices from the frames? */
export function verifyFixture(fixture: ProtocolFixture): boolean {
  const decoded = replay(fixture.config, fixture.frames);
  if (decoded.length !== fixture.expected.length) return false;
  return decoded.every((d, i) => {
    const e = fixture.expected[i];
    return e !== undefined && d.id === e.id && d.price === e.price;
  });
}
