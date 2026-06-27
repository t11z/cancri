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
import { connectFirestoreEmulator, getFirestore, type Firestore } from "firebase/firestore";
import {
  deleteApp as adminDeleteApp,
  initializeApp as adminInitializeApp,
  type App as AdminApp,
} from "firebase-admin/app";
import { getAuth as adminGetAuth } from "firebase-admin/auth";
import { getFirestore as adminGetFirestore } from "firebase-admin/firestore";
import type { Position } from "@cancri/data-contracts";
import { loadInventory, saveInventory } from "./persistence.js";

/**
 * Phase-2 persistence + auth integration, run under the REAL security rules via
 * `firebase emulators:exec --only auth,firestore`. Proves the confirmed book
 * round-trips and survives a session (sign-out / sign-in), as the owner.
 *
 * Access is invite-gated (ADR-0012): a book is reachable only by an allowlisted,
 * verified-email user. The Admin SDK seeds those preconditions (a verified user
 * and an /allowlist/{email} entry — both admin-only paths) before the client runs.
 */
const USERS = ["alice@cancri.test", "bob@cancri.test", "carol@cancri.test"];

let app: FirebaseApp;
let auth: Auth;
let db: Firestore;
let adminApp: AdminApp;

beforeAll(async () => {
  app = initializeApp(
    { apiKey: "demo", projectId: "demo-cancri", authDomain: "demo-cancri.firebaseapp.com" },
    "persist-test",
  );
  auth = getAuth(app);
  db = getFirestore(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);

  // Seed the invite-allowlist preconditions via the Admin SDK (rules bypassed).
  adminApp = adminInitializeApp({ projectId: "demo-cancri" }, "persist-admin");
  for (const email of USERS) {
    await ensureVerifiedUser(adminApp, email);
    await adminGetFirestore(adminApp).doc(`allowlist/${email}`).set({ addedAt: 0 });
  }
});

afterAll(async () => {
  await deleteApp(app);
  await adminDeleteApp(adminApp);
});

/** Create (or re-verify) an email/password user with a verified email, so the
 *  client's token satisfies the rules' email_verified gate after sign-in. */
async function ensureVerifiedUser(admin: AdminApp, email: string): Promise<void> {
  const adminAuth = adminGetAuth(admin);
  try {
    const u = await adminAuth.getUserByEmail(email);
    await adminAuth.updateUser(u.uid, { emailVerified: true });
  } catch {
    await adminAuth.createUser({ email, password: "passphrase1", emailVerified: true });
  }
}

const POSITIONS: Position[] = [
  { isin: "US0378331005", symbol: "AAPL", name: "Apple Inc.", quantity: 42, source: "NASDAQ", accent: "#7b5cff" },
  { isin: "US67066G1040", symbol: "NVDA", name: "NVIDIA Corp.", quantity: 30, source: "NASDAQ", accent: "#36f9d0" },
];

async function asUser(email: string): Promise<string> {
  try {
    await signInWithEmailAndPassword(auth, email, "passphrase1");
  } catch {
    await createUserWithEmailAndPassword(auth, email, "passphrase1");
  }
  const uid = auth.currentUser?.uid;
  if (uid === undefined) throw new Error("sign-in did not yield a user");
  return uid;
}

describe("inventory persistence (auth + firestore emulator, real rules)", () => {
  test("save then load round-trips the confirmed inventory", async () => {
    const uid = await asUser("alice@cancri.test");
    await saveInventory(db, uid, POSITIONS);
    const loaded = await loadInventory(db, uid);
    expect(loaded).not.toBeNull();
    expect(loaded?.length).toBe(2);
    expect(loaded?.[0]?.symbol).toBe("AAPL");
    expect(loaded?.[0]?.quantity).toBe(42);
    expect(loaded?.[1]?.symbol).toBe("NVDA");
    await signOut(auth);
  });

  test("a fresh user has no inventory yet", async () => {
    const uid = await asUser("bob@cancri.test");
    expect(await loadInventory(db, uid)).toBeNull();
    await signOut(auth);
  });

  test("inventory survives a sign-out then sign-in (persists per user)", async () => {
    const uid1 = await asUser("carol@cancri.test");
    await saveInventory(db, uid1, POSITIONS);
    await signOut(auth);

    const uid2 = await asUser("carol@cancri.test");
    expect(uid2).toBe(uid1);
    const loaded = await loadInventory(db, uid2);
    expect(loaded?.[0]?.symbol).toBe("AAPL");
    await signOut(auth);
  });
});
