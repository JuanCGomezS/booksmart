import { deleteField, doc, getDoc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { auth, db } from './firebase';

const BASE32_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ234567';
const CODE_LENGTH = 26;

export type EnrollmentStaffStatus = 'active' | 'inactive';

export function normalizeStaffEnrollmentCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z2-7]/g, '');
}

export function formatStaffEnrollmentCode(value: string): string {
  return normalizeStaffEnrollmentCode(value).match(/.{1,5}/g)?.join('-') || '';
}

export function generateStaffEnrollmentCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (byte) => BASE32_ALPHABET[byte % BASE32_ALPHABET.length]).join('');
}

/** Enrolls the signed-in Customer as inactive Staff for the code's business. */
export async function joinBusinessWithCode(enteredCode: string): Promise<void> {
  const user = auth.currentUser;
  const code = normalizeStaffEnrollmentCode(enteredCode);
  if (!user || code.length !== CODE_LENGTH) throw new Error('No fue posible unirte al negocio. Revisa el código e inténtalo nuevamente.');

  const userRef = doc(db, 'users', user.uid);
  const codeRef = doc(db, 'staffEnrollmentCodes', code);

  try {
    await runTransaction(db, async (transaction) => {
      const [userSnapshot, codeSnapshot] = await Promise.all([transaction.get(userRef), transaction.get(codeRef)]);
      if (!userSnapshot.exists() || userSnapshot.data().role !== 'customer' || !codeSnapshot.exists()) throw new Error('invalid enrollment');

      const businessId = codeSnapshot.data().businessId;
      if (typeof businessId !== 'string' || !businessId) throw new Error('invalid enrollment');
      const name = typeof userSnapshot.data().name === 'string' && userSnapshot.data().name.trim()
        ? userSnapshot.data().name.trim()
        : 'Nuevo integrante del personal';
      const staffRef = doc(db, 'barbers', businessId, 'barbers', user.uid);

      transaction.set(staffRef, { name, role: 'Staff', accountUid: user.uid, active: false, accountStatus: 'inactive', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      // The code remains only on the account document until a Storeadmin activates Staff.
      transaction.update(userRef, { role: 'staff', barberId: businessId, businessIds: [businessId], staffId: user.uid, enrollmentCode: code, updatedAt: serverTimestamp() });
    });
  } catch {
    // Do not disclose whether a code exists, is rotated, or belongs to a business.
    throw new Error('No fue posible unirte al negocio. Revisa el código e inténtalo nuevamente.');
  }
}

export async function getStaffEnrollmentCode(businessId: string): Promise<string | null> {
  const snapshot = await getDoc(doc(db, 'barbers', businessId, 'staffControl', 'enrollment'));
  if (!snapshot.exists() || typeof snapshot.data().code !== 'string') return null;
  return snapshot.data().code;
}

export async function rotateStaffEnrollmentCode(businessId: string): Promise<string> {
  const controlRef = doc(db, 'barbers', businessId, 'staffControl', 'enrollment');
  const nextCode = generateStaffEnrollmentCode();
  await runTransaction(db, async (transaction) => {
    const controlSnapshot = await transaction.get(controlRef);
    const previousCode = controlSnapshot.exists() && typeof controlSnapshot.data().code === 'string'
      ? controlSnapshot.data().code
      : null;
    if (previousCode) transaction.delete(doc(db, 'staffEnrollmentCodes', previousCode));
    transaction.set(doc(db, 'staffEnrollmentCodes', nextCode), { businessId, createdAt: serverTimestamp() });
    transaction.set(controlRef, { code: nextCode, rotatedAt: serverTimestamp() });
  });
  return nextCode;
}

export async function setEnrollmentStaffStatus(
  businessId: string,
  staffId: string,
  status: EnrollmentStaffStatus,
): Promise<void> {
  const publicRef = doc(db, 'barbers', businessId, 'barbers', staffId);
  await runTransaction(db, async (transaction) => {
    transaction.update(publicRef, { active: status === 'active', accountStatus: status, updatedAt: serverTimestamp() });
    if (status === 'active') transaction.update(doc(db, 'users', staffId), { enrollmentCode: deleteField(), updatedAt: serverTimestamp() });
  });
}

/** Links the authenticated Storeadmin to one existing, unlinked professional profile. */
export async function linkStoreadminToProfessional(businessId: string, staffId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Tu sesión expiró. Ingresa nuevamente para vincular tu perfil.');

  const profileRef = doc(db, 'barbers', businessId, 'barbers', staffId);
  await runTransaction(db, async (transaction) => {
    const profileSnapshot = await transaction.get(profileRef);
    const profile = profileSnapshot.data();
    if (!profileSnapshot.exists() || profile?.accountUid || profile?.accountStatus || profile?.userId || profile?.active !== true) {
      throw new Error('Este perfil ya no está disponible para vincularlo a tu cuenta.');
    }

    transaction.update(profileRef, { accountUid: user.uid, updatedAt: serverTimestamp() });
    transaction.update(doc(db, 'users', user.uid), { staffId, professionalBusinessId: businessId, updatedAt: serverTimestamp() });
  });
}

/** Retires a profile without deleting booking, schedule, lock, or service references. */
export async function retireProfessional(businessId: string, staffId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Tu sesión expiró. Ingresa nuevamente para retirar el perfil.');

  const profileRef = doc(db, 'barbers', businessId, 'barbers', staffId);
  await runTransaction(db, async (transaction) => {
    const profileSnapshot = await transaction.get(profileRef);
    if (!profileSnapshot.exists()) throw new Error('El perfil profesional ya no existe. Actualiza la lista e inténtalo nuevamente.');
    const profile = profileSnapshot.data();
    const accountUid = typeof profile.accountUid === 'string'
      ? profile.accountUid
      : typeof profile.accountStatus === 'string' ? staffId : null;

    transaction.update(profileRef, {
      active: false,
      ...(accountUid ? { accountUid: deleteField(), accountStatus: deleteField() } : {}),
      updatedAt: serverTimestamp(),
    });

    if (!accountUid) return;
    const accountRef = doc(db, 'users', accountUid);
    if (profile.accountStatus === 'active' || profile.accountStatus === 'inactive') {
      transaction.update(accountRef, {
        role: 'customer',
        barberId: deleteField(),
        businessIds: deleteField(),
        staffId: deleteField(),
        professionalBusinessId: deleteField(),
        enrollmentCode: deleteField(),
        updatedAt: serverTimestamp(),
      });
      return;
    }

    transaction.update(accountRef, { staffId: deleteField(), professionalBusinessId: deleteField(), updatedAt: serverTimestamp() });
  });
}
