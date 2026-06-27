import { initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, type Firestore } from "firebase/firestore";

/**
 * Firebase client init (ADR-0004). In dev / emulator mode the SDK is pointed at
 * the local Emulator Suite; real config comes from VITE_FIREBASE_* env at deploy.
 * The web client only ever touches Auth + Firestore here; RTDB (quotes) arrives
 * with the live feed in Phase 4.
 */
const env = import.meta.env;
const useEmulator = (env.VITE_USE_EMULATOR ?? (env.DEV ? "true" : "false")) === "true";

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY ?? "demo-api-key",
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? "demo-cancri.firebaseapp.com",
  projectId: env.VITE_FIREBASE_PROJECT_ID ?? "demo-cancri",
  appId: env.VITE_FIREBASE_APP_ID ?? "demo-app",
};

export const app: FirebaseApp = initializeApp(firebaseConfig);
export const auth: Auth = getAuth(app);
export const db: Firestore = getFirestore(app);

if (useEmulator) {
  const host = env.VITE_EMULATOR_HOST ?? "127.0.0.1";
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, 8080);
}
