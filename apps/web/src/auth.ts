import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { auth } from "./firebase.js";

export type { User };

/** Subscribe to auth state; the gate that decides which screen the app shows. */
export function onAuth(cb: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, cb);
}

export function currentUser(): User | null {
  return auth.currentUser;
}

/**
 * Sign in with email/passphrase; auto-register on first use (this is an access-
 * gated personal terminal — a real invite-allowlist policy is a later decision).
 */
export async function signInOrRegister(email: string, password: string): Promise<void> {
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "auth/user-not-found" || code === "auth/invalid-credential") {
      await createUserWithEmailAndPassword(auth, email, password);
      return;
    }
    throw err;
  }
}

export async function signInGoogle(): Promise<void> {
  await signInWithPopup(auth, new GoogleAuthProvider());
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
}
