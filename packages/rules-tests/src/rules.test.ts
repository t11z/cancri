import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, test } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { get, ref, set } from "firebase/database";

const rulesFile = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

let env: RulesTestEnvironment;

beforeAll(async () => {
  // Emulator hosts are auto-detected from FIRESTORE_EMULATOR_HOST /
  // FIREBASE_DATABASE_EMULATOR_HOST, which `firebase emulators:exec` sets.
  env = await initializeTestEnvironment({
    projectId: "demo-cancri",
    firestore: { rules: rulesFile("../../../config/firestore.rules") },
    database: { rules: rulesFile("../../../config/database.rules.json") },
  });
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

describe("Firestore — the book is private per user (ADR-0004)", () => {
  test("a user can write and read their own inventory", async () => {
    const alice = env.authenticatedContext("alice").firestore();
    await assertSucceeds(
      setDoc(doc(alice, "users/alice/inventory/current"), { positions: [] }),
    );
    await assertSucceeds(getDoc(doc(alice, "users/alice/inventory/current")));
  });

  test("a user can write nested drafts and audit under their own subtree", async () => {
    const alice = env.authenticatedContext("alice").firestore();
    await assertSucceeds(setDoc(doc(alice, "users/alice/drafts/d1"), { raw: "12 AAPL" }));
    await assertSucceeds(
      setDoc(doc(alice, "users/alice/inventoryHistory/2026-06-27T00:00:00Z"), { positions: [] }),
    );
  });

  test("a user CANNOT read another user's inventory", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users/bob/inventory/current"), {
        positions: [{ isin: "US0378331005", quantity: 42 }],
      });
    });
    const alice = env.authenticatedContext("alice").firestore();
    await assertFails(getDoc(doc(alice, "users/bob/inventory/current")));
  });

  test("a user CANNOT write into another user's subtree", async () => {
    const alice = env.authenticatedContext("alice").firestore();
    await assertFails(setDoc(doc(alice, "users/bob/inventory/current"), { positions: [] }));
  });

  test("an unauthenticated client is denied", async () => {
    const anon = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anon, "users/alice/inventory/current")));
    await assertFails(setDoc(doc(anon, "users/alice/inventory/current"), { positions: [] }));
  });
});

describe("Realtime Database — quotes are public-to-signed-in, client read-only (ADR-0004/0005)", () => {
  test("a signed-in user can read a quote but cannot write it", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await set(ref(ctx.database(), "quotes/US0378331005"), { lastPrice: 212.4 });
    });
    const alice = env.authenticatedContext("alice").database();
    await assertSucceeds(get(ref(alice, "quotes/US0378331005")));
    await assertFails(set(ref(alice, "quotes/US0378331005"), { lastPrice: 999 }));
  });

  test("a signed-in user can read feed status but cannot write it", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await set(ref(ctx.database(), "feed/status"), { connection: "live" });
    });
    const alice = env.authenticatedContext("alice").database();
    await assertSucceeds(get(ref(alice, "feed/status")));
    await assertFails(set(ref(alice, "feed/status"), { connection: "degraded" }));
  });

  test("an unauthenticated client cannot read quotes", async () => {
    const anon = env.unauthenticatedContext().database();
    await assertFails(get(ref(anon, "quotes/US0378331005")));
  });
});
