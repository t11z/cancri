/**
 * The scheduled probe's decision logic (brief §D). Liveness: did a well-formed
 * tick arrive within N seconds? Sanity: is the primary price within X% of the
 * independent reference (Yahoo)? The heavy capture-and-diff fires only after
 * several consecutive non-healthy probes.
 */
export type ProbeVerdict = "healthy" | "stale" | "diverged";

export interface ProbeInput {
  readonly lastTickAgeMs: number;
  readonly sustainedDivergence: boolean;
  readonly livenessTimeoutMs?: number;
}

export function probe(input: ProbeInput): ProbeVerdict {
  const timeout = input.livenessTimeoutMs ?? 10_000;
  if (input.lastTickAgeMs > timeout) return "stale";
  if (input.sustainedDivergence) return "diverged";
  return "healthy";
}

/** Escalate to the heavy capture-and-diff only on sustained failure. */
export function shouldCapture(consecutiveFailures: number, threshold = 3): boolean {
  return consecutiveFailures >= threshold;
}
