import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
  deleteField,
  where,
} from 'firebase/firestore';
import { db } from './firebase';
import { DATA } from './data';
import type { BarberStaff, BusinessAssignmentOption, StaffAssignment, User, UserRole } from './types';

const ADMIN_CACHE_TTL = 30 * 60 * 1000;
let businessAssignmentOptionsPromise: Promise<BusinessAssignmentOption[]> | null = null;

/**
 * Loads name-only business options once for the mounted superadmin manager.
 * This is an on-demand read, never a realtime listener.
 */
export function getBusinessAssignmentOptions(): Promise<BusinessAssignmentOption[]> {
  if (!businessAssignmentOptionsPromise) {
    businessAssignmentOptionsPromise = getDocs(collection(db, 'barbers')).then((snapshot) => snapshot.docs
      .map((item) => ({ id: item.id, name: typeof item.data().name === 'string' ? item.data().name : 'Untitled business' }))
      .sort((left, right) => left.name.localeCompare(right.name)));
  }
  return businessAssignmentOptionsPromise;
}

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
 * Obtiene storeadmins canónicos y usuarios legacy durante el rollout.
 */
export async function getBarberAdmins(): Promise<User[]> {
  const cacheKey = 'storeadmins_cache_v2';
  const cached = localStorage.getItem(cacheKey);

  if (cached) {
    const { data, expiresAt } = JSON.parse(cached);
    if (Date.now() < expiresAt) {
      return data;
    }
  }

  try {
    const ref = collection(db, 'users');
    const [canonical, legacy] = await Promise.all([
      getDocs(query(ref, where('role', '==', DATA.USER_ROLE.STOREADMIN))),
      getDocs(query(ref, where('role', '==', 'barber_admin'))),
    ]);

    const data = [...canonical.docs, ...legacy.docs]
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
    console.error('Error fetching storeadmins:', error);
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
  businessIds: string[] = [],
): Promise<void> {
  const userRef = doc(db, 'users', uid);
  const payload: Record<string, unknown> = {
    role,
    updatedAt: serverTimestamp(),
  };

  const normalizedBusinessIds = [...new Set(businessIds.map((id) => id.trim()).filter(Boolean))];
  if (role === DATA.USER_ROLE.STOREADMIN) {
    payload.businessIds = normalizedBusinessIds;
    payload.barberId = normalizedBusinessIds[0] ?? null;
    payload.staffAssignments = [];
    payload.staffId = null;
  } else if (role === DATA.USER_ROLE.STAFF) {
    payload.businessIds = normalizedBusinessIds;
  } else {
    payload.barberId = null;
    payload.businessIds = [];
    payload.staffAssignments = [];
    payload.staffId = null;
  }

  const currentUser = await getDoc(userRef);
  const previous = currentUser.exists() ? (currentUser.data() as User) : null;
  const batch = writeBatch(db);
  const previousAssignments = previous?.staffAssignments?.length
    ? previous.staffAssignments
    : previous?.barberId && previous.staffId ? [{ businessId: previous.barberId, staffId: previous.staffId }] : [];

  const nextAssignments = role === DATA.USER_ROLE.STAFF
    ? await resolveStaffAssignments(uid, previous, normalizedBusinessIds)
    : [];

  if (role === DATA.USER_ROLE.STAFF) {
    payload.staffAssignments = nextAssignments;
    payload.barberId = nextAssignments[0]?.businessId ?? null;
    payload.staffId = nextAssignments[0]?.staffId ?? null;
  }
  batch.update(userRef, payload);

  for (const assignment of nextAssignments) {
    const staffRef = doc(db, 'barbers', assignment.businessId, 'barbers', assignment.staffId);
    const existing = await getDoc(staffRef);
    if (existing.exists()) {
      const boundUserId = existing.data().userId;
      if (typeof boundUserId === 'string' && boundUserId && boundUserId !== uid) {
        throw new Error(`The selected staff record in ${assignment.businessId} belongs to another user.`);
      }
      batch.update(staffRef, {
        userId: uid,
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.set(staffRef, createdStaffRecord(uid, previous));
    }
  }
  for (const assignment of previousAssignments) {
    if (nextAssignments.some((next) => next.businessId === assignment.businessId && next.staffId === assignment.staffId)) continue;
    const staffRef = doc(db, 'barbers', assignment.businessId, 'barbers', assignment.staffId);
    const existing = await getDoc(staffRef);
    if (!existing.exists() || existing.data().userId !== uid) continue;
    batch.update(staffRef, {
      userId: deleteField(),
      updatedAt: serverTimestamp(),
    });
  }

  await batch.commit();
}

function normalizedAssignmentsFor(user: User | null): StaffAssignment[] {
  const assignments = user?.staffAssignments?.length
    ? user.staffAssignments
    : user?.barberId && user.staffId ? [{ businessId: user.barberId, staffId: user.staffId }] : [];
  return assignments.filter((assignment, index, values) => assignment.businessId && assignment.staffId &&
    values.findIndex((value) => value.businessId === assignment.businessId) === index);
}

async function resolveStaffAssignments(uid: string, user: User | null, businessIds: string[]): Promise<StaffAssignment[]> {
  const previousByBusiness = new Map(normalizedAssignmentsFor(user).map((assignment) => [assignment.businessId, assignment]));
  return Promise.all(businessIds.map(async (businessId) => {
    const explicit = previousByBusiness.get(businessId);
    if (explicit) return explicit;

    const boundRecords = await getDocs(query(collection(db, 'barbers', businessId, 'barbers'), where('userId', '==', uid)));
    const reusable = boundRecords.docs.map((item) => item.id).sort()[0];
    return { businessId, staffId: reusable || deterministicStaffId(uid) };
  }));
}

function deterministicStaffId(uid: string): string {
  return `user-${uid}`;
}

function createdStaffRecord(uid: string, user: User | null): Omit<BarberStaff, 'id'> {
  const profileName = typeof user?.displayName === 'string' && user.displayName.trim()
    ? user.displayName.trim()
    : typeof user?.name === 'string' && user.name.trim() ? user.name.trim() : null;
  const name = profileName
    ? profileName
    : 'Staff member (edit name)';
  return { name, role: 'Staff', userId: uid, active: true, createdAt: serverTimestamp() } as Omit<BarberStaff, 'id'>;
}
