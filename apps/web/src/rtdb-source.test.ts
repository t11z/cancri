import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
  type Auth,
} from "firebase/auth";
import { connectDatabaseEmulator, getDatabase, type Database } from "firebase/database";
import {
  deleteApp as adminDeleteApp,
  initializeApp as adminInitializeApp,
  type App as AdminApp,
} from "firebase-admin/app";
import { getDatabase as adminGetDatabase } from "firebase-admin/database";
import { makeTick } from "@cancri/data-contracts";
import { RtdbSource } from "./rtdb-source.js";

// Node global, declared locally so the browser app's tsconfig stays node-free.
declare const process: { env: Record<string, string | undefined> };

/**
 * Phase-4 RTDB tick-bus transport (ADR-0005), against the Database emulator:
 * the server (Admin SDK) writes a normalised tick to /quotes/{isin}; the client
 * RtdbSource — under the real rules, signed in — receives it. Proves the wire end
 * to end without the L&S live source.
 */
const NS = "demo-cancri";
const DB_URL = `http://127.0.0.1:9000/?ns=${NS}`;
const ISIN = "US0378331005";

let clientApp: FirebaseApp;
let auth: Auth;
let db: Database;
let adminApp: AdminApp;

beforeAll(async () => {
  process.env["FIREBASE_DATABASE_EMULATOR_HOST"] = "127.0.0.1:9000";
  adminApp = adminInitializeApp({ databaseURL: DB_URL, projectId: NS }, "rtdb-seed");

  clientApp = initializeApp({ apiKey: "demo", projectId: NS, databaseURL: DB_URL }, "rtdb-test");
  auth = getAuth(clientApp);
  db = getDatabase(clientApp);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectDatabaseEmulator(db, "127.0.0.1", 9000);

  try {
    await signInWithEmailAndPassword(auth, "trader@cancri.test", "passphrase1");
  } catch {
    await createUserWithEmailAndPassword(auth, "trader@cancri.test", "passphrase1");
  }
});

afterAll(async () => {
  await adminDeleteApp(adminApp);
  await deleteApp(clientApp);
});

function waitFor<T>(get: () => T | undefined, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = (): void => {
      const v = get();
      if (v !== undefined) return resolve(v);
      if (Date.now() - started > timeoutMs) return reject(new Error("timed out waiting"));
      setTimeout(tick, 25);
    };
    tick();
  });
}

describe("RtdbSource — live tick transport (Database emulator)", () => {
  test("a tick written by the server reaches the client via the SourceAdapter", async () => {
    const source = new RtdbSource(db);
    const ticks: { lastPrice: number }[] = [];
    source.onTick((t) => ticks.push(t));
    source.subscribe([ISIN]);

    const tick = makeTick({
      instrumentId: ISIN,
      lastPrice: 212.4,
      previousClose: 210,
      timestamp: 1,
      source: "L&S",
      freshness: "live",
    });
    await adminGetDatabase(adminApp).ref(`quotes/${ISIN}`).set(tick);

    const got = await waitFor(() => ticks.at(-1));
    expect(got.lastPrice).toBe(212.4);
    source.stop();
  });
});
