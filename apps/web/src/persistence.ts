import { doc, getDoc, serverTimestamp, setDoc, type Firestore } from "firebase/firestore";
import type { Position } from "@cancri/data-contracts";

/**
 * The book — confirmed inventory, persisted per user so it survives sessions
 * (ADR-0004). The Firestore instance is injected so this module is unit-testable
 * against the emulator without the browser. Path is uid-scoped; the security
 * rules (config/firestore.rules) enforce that only the owner can read/write it.
 */
const inventoryPath = (uid: string): string => `users/${uid}/inventory/current`;

export async function saveInventory(
  db: Firestore,
  uid: string,
  positions: readonly Position[],
): Promise<void> {
  await setDoc(doc(db, inventoryPath(uid)), {
    positions: positions.map((p) => ({ ...p })),
    updatedAt: serverTimestamp(),
  });
}

export async function loadInventory(db: Firestore, uid: string): Promise<Position[] | null> {
  const snap = await getDoc(doc(db, inventoryPath(uid)));
  if (!snap.exists()) return null;
  const positions = snap.data()["positions"];
  return Array.isArray(positions) ? (positions as Position[]) : null;
}
