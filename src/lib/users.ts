import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from './firebase';
import { DATA } from './data';
import type { User, UserRole } from './types';

const ADMIN_CACHE_TTL = 30 * 60 * 1000;

export async function getAllUsers(): Promise<User[]> {
  const ref = collection(db, 'users');
  const q = query(ref, orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);

  return snap.docs.map((item) => ({
    ...(item.data() as User),
    uid: item.id,
  }));
}

/**
 * Obtener admins de barbería (barber_admin) con cache
 */
export async function getBarberAdmins(): Promise<User[]> {
  const cacheKey = 'barber_admins_cache';
  const cached = localStorage.getItem(cacheKey);

  if (cached) {
    const { data, expiresAt } = JSON.parse(cached);
    if (Date.now() < expiresAt) {
      return data;
    }
  }

  try {
    const ref = collection(db, 'users');
    const q = query(ref, where('role', '==', DATA.USER_ROLE.BARBER_ADMIN));
    const snap = await getDocs(q);

    const data = snap.docs
      .map((item) => ({
        ...(item.data() as User),
        uid: item.id,
      }))
      .sort((a, b) => (a.email ?? '').localeCompare(b.email ?? ''));

    localStorage.setItem(cacheKey, JSON.stringify({
      data,
      expiresAt: Date.now() + ADMIN_CACHE_TTL,
    }));

    return data;
  } catch (error) {
    console.error('Error fetching barber admins:', error);
    return [];
  }
}

/**
 * Obtener UID por email
 */
export async function getUserIdByEmail(email: string): Promise<string | null> {
  try {
    const ref = collection(db, 'users');
    const q = query(ref, where('email', '==', email));
    const snap = await getDocs(q);
    
    if (snap.docs.length === 0) return null;
    return snap.docs[0].id;
  } catch (error) {
    console.error('Error fetching user by email:', error);
    return null;
  }
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

  if (role === DATA.USER_ROLE.BARBER || role === DATA.USER_ROLE.BARBER_ADMIN) {
    payload.barberId = barberId ?? null;
  } else {
    payload.barberId = null;
  }

  await updateDoc(userRef, payload);
}
