import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
} from "firebase/auth";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
  type Functions,
} from "firebase/functions";
import { connectFirestoreEmulator, doc, getDoc, getFirestore, type Firestore } from "firebase/firestore";
import type { Position, ProposedPosition } from "@cancri/data-contracts";

/**
 * Phase-3b end-to-end through the Functions emulator (MockGemini server-side):
 * the client invokes the callables exactly as the app does, proving the data path
 * and that normalisation runs server-side under auth — no key in the client.
 */
let app: FirebaseApp;
let auth: Auth;
let fns: Functions;
let db: Firestore;
let uid: string;

beforeAll(async () => {
  app = initializeApp({ apiKey: "demo", projectId: "demo-cancri" }, "callable-test");
  auth = getAuth(app);
  fns = getFunctions(app, "europe-west1");
  db = getFirestore(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFunctionsEmulator(fns, "127.0.0.1", 5001);
  connectFirestoreEmulator(db, "127.0.0.1", 8080);

  const email = "trader@cancri.test";
  try {
    await signInWithEmailAndPassword(auth, email, "passphrase1");
  } catch {
    await createUserWithEmailAndPassword(auth, email, "passphrase1");
  }
  uid = auth.currentUser?.uid ?? "";
});

afterAll(async () => {
  await deleteApp(app);
});

describe("Gemini callables (Functions emulator, MockGemini)", () => {
  test("normalizeInventory resolves symbols and gates ISINs", async () => {
    const fn = httpsCallable<{ input: { kind: string; content: string } }, { proposal: ProposedPosition[] }>(
      fns,
      "normalizeInventory",
    );
    const res = await fn({ input: { kind: "text", content: "12 AAPL, 0.5 BTC, 30 NVDA" } });
    const bySymbol = new Map(res.data.proposal.map((p) => [p.symbol, p]));
    expect(bySymbol.get("AAPL")?.isin).toBe("US0378331005");
    expect(bySymbol.get("AAPL")?.quantity).toBe(12);
    // BTC has no ISIN → flagged below the review threshold
    expect(bySymbol.get("BTC")?.isin).toBeUndefined();
    expect(bySymbol.get("BTC")?.confidence).toBeLessThan(0.7);
  });

  test("confirmInventory persists the book server-side", async () => {
    const positions: Position[] = [
      { isin: "US0378331005", symbol: "AAPL", name: "Apple Inc.", quantity: 42, source: "gemini", accent: "#7b5cff" },
    ];
    const fn = httpsCallable<{ positions: Position[] }, { ok: boolean; count: number }>(
      fns,
      "confirmInventory",
    );
    const res = await fn({ positions });
    expect(res.data.ok).toBe(true);
    expect(res.data.count).toBe(1);

    const snap = await getDoc(doc(db, `users/${uid}/inventory/current`));
    expect(snap.exists()).toBe(true);
    expect(snap.data()?.["positions"]?.length).toBe(1);
  });

  test("an unauthenticated caller is rejected", async () => {
    await signOut(auth);
    const fn = httpsCallable(fns, "normalizeInventory");
    await expect(fn({ input: { kind: "text", content: "1 AAPL" } })).rejects.toThrow();
  });
});
