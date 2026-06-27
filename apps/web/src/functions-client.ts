import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
  type Functions,
} from "firebase/functions";
import type { Position, ProposedPosition } from "@cancri/data-contracts";
import { app } from "./firebase.js";

/**
 * Client for the server-side Gemini callables (ADR-0008). The region must match
 * the functions' deploy region (europe-west1, ADR-0001). No Gemini key ever
 * reaches the client — it only invokes the callable.
 */
const REGION = "europe-west1";
const env = import.meta.env;
const useEmulator = (env.VITE_USE_EMULATOR ?? (env.DEV ? "true" : "false")) === "true";

const fns: Functions = getFunctions(app, REGION);
if (useEmulator) {
  connectFunctionsEmulator(fns, env.VITE_EMULATOR_HOST ?? "127.0.0.1", 5001);
}

export interface NormalizeInput {
  kind: "text" | "csv" | "xlsx";
  content: string;
}

export async function callNormalize(input: NormalizeInput): Promise<ProposedPosition[]> {
  const fn = httpsCallable<{ input: NormalizeInput }, { proposal: ProposedPosition[] }>(
    fns,
    "normalizeInventory",
  );
  const res = await fn({ input });
  return res.data.proposal;
}

export async function callConfirm(positions: readonly Position[]): Promise<number> {
  const fn = httpsCallable<{ positions: readonly Position[] }, { ok: boolean; count: number }>(
    fns,
    "confirmInventory",
  );
  const res = await fn({ positions });
  return res.data.count;
}
