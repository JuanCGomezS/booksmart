import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db } from './firebase';
import type { User, UserRole } from './types';

export async function getAllUsers(): Promise<User[]> {
  const ref = collection(db, 'users');
  const q = query(ref, orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);

  return snap.docs.map((item) => ({
    ...(item.data() as User),
    uid: item.id,
  }));
}

export async function updateUserRole(
  uid: string,
  role: UserRole,
  barberId?: string
): Promise<void> {
  const userRef = doc(db, 'users', uid);
  const payload: Record<string, unknown> = {
    role,
    updatedAt: serverTimestamp(),
  };

  if (role === 'barber' || role === 'barber_admin') {
    payload.barberId = barberId ?? null;
  } else {
    payload.barberId = null;
  }

  await updateDoc(userRef, payload);
}
