import {
  GoogleAuthProvider,
  onAuthStateChanged,
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
 * Sign in with Google. The terminal is access-gated: any Google account can
 * authenticate, but the invite-allowlist (enforced in the Firestore security
 * rules, ADR-0012) decides who may actually mount a book.
 */
export async function signInGoogle(): Promise<void> {
  await signInWithPopup(auth, new GoogleAuthProvider());
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
}
