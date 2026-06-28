import { HttpsError, onCall } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { z } from "zod";
import type { Position } from "@cancri/data-contracts";
import { normaliseInventory } from "./normalize.js";
import { duckduckgoFetcher, resolveLogo } from "./logo.js";

/**
 * Callable Cloud Functions (2nd gen, ADR-0002/0008), pinned to europe-west1
 * (ADR-0001). Both require an authenticated caller; Gemini runs server-side with
 * no key in the client.
 */
initializeApp();

const REGION = "europe-west1";

const NormalizeSchema = z.object({
  input: z.object({
    kind: z.enum(["text", "csv", "xlsx"]),
    content: z.string(),
  }),
});

export const normalizeInventory = onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "sign in to normalise your inventory");
  const parsed = NormalizeSchema.safeParse(req.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", "expected { input: { kind, content } }");
  }
  const proposal = await normaliseInventory(parsed.data.input);
  return { proposal };
});

const PositionSchema = z.object({
  isin: z.string(),
  symbol: z.string(),
  name: z.string(),
  quantity: z.number(),
  source: z.string(),
  accent: z.string(),
  costBasis: z.number().optional(),
  unit: z.string().optional(),
  domain: z.string().optional(),
});
const ConfirmSchema = z.object({ positions: z.array(PositionSchema) });

export const confirmInventory = onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "sign in to confirm your inventory");
  const parsed = ConfirmSchema.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "invalid positions payload");

  // Server-side persistence of the confirmed book (brief §3). Strict ISIN
  // enforcement activates in Phase 4 once real ISINs flow from the resolver.
  const positions: Position[] = parsed.data.positions;
  await getFirestore()
    .doc(`users/${req.auth.uid}/inventory/current`)
    .set({ positions, updatedAt: FieldValue.serverTimestamp() });

  return { ok: true, count: positions.length };
});

const LogoSchema = z.object({ symbol: z.string(), domain: z.string().optional() });

export const logo = onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "sign in");
  const parsed = LogoSchema.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "expected { symbol, domain? }");
  // Server-side resolution via the domain icon provider; monogram on any miss (ADR-0014).
  return await resolveLogo(parsed.data, duckduckgoFetcher);
});
