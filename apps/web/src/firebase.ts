import { initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, type Firestore } from "firebase/firestore";
import { connectDatabaseEmulator, getDatabase, type Database } from "firebase/database";

/**
 * Firebase client init (ADR-0004). In dev / emulator mode the SDK is pointed at
 * the local Emulator Suite; real config comes from VITE_FIREBASE_* env at deploy.
 * Auth + Firestore (the book) plus Realtime Database (the tick wire, ADR-0005):
 * the client only ever READS /quotes + /feed/status from RTDB.
 */
const env = import.meta.env;

/**
 * Read a Vite-injected env var, treating an empty string as absent. An unset
 * GitHub Actions `${{ vars.* }}` expands to "" (not undefined), so a bare `??`
 * fallback would bake an invalid *empty* config into the bundle — `getAuth()`
 * then throws `auth/invalid-api-key` at module load, `start()` never runs, and
 * the page stays blank. Coalescing "" to the fallback keeps the documented
 * demo-config degradation instead.
 */
const envOr = (value: string | undefined, fallback: string): string =>
  value != null && value !== "" ? value : fallback;

const useEmulator = envOr(env.VITE_USE_EMULATOR, env.DEV ? "true" : "false") === "true";

const firebaseConfig = {
  apiKey: envOr(env.VITE_FIREBASE_API_KEY, "demo-api-key"),
  authDomain: envOr(env.VITE_FIREBASE_AUTH_DOMAIN, "demo-cancri.firebaseapp.com"),
  projectId: envOr(env.VITE_FIREBASE_PROJECT_ID, "demo-cancri"),
  appId: envOr(env.VITE_FIREBASE_APP_ID, "demo-app"),
  databaseURL: envOr(
    env.VITE_FIREBASE_DATABASE_URL,
    "https://demo-cancri-default-rtdb.europe-west1.firebasedatabase.app",
  ),
};

export const app: FirebaseApp = initializeApp(firebaseConfig);
export const auth: Auth = getAuth(app);
export const db: Firestore = getFirestore(app);
export const rtdb: Database = getDatabase(app);

if (useEmulator) {
  const host = env.VITE_EMULATOR_HOST ?? "127.0.0.1";
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, 8080);
  connectDatabaseEmulator(rtdb, host, 9000);
}
