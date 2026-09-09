import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

function profileRef(businessId: string, uid: string) {
  return doc(db, 'barbers', businessId, 'barbers', uid);
}

/** Creates the Storeadmin's optional professional listing from their account name. */
export async function createOwnStoreadminProfessionalProfile(businessId: string, uid: string) {
  const userRef = doc(db, 'users', uid);
  const staffRef = profileRef(businessId, uid);
  await runTransaction(db, async (transaction) => {
    const [userSnapshot, staffSnapshot] = await Promise.all([
      transaction.get(userRef),
      transaction.get(staffRef),
    ]);
    const user = userSnapshot.data();
    const hasBusiness = Array.isArray(user?.businessIds) && user.businessIds.includes(businessId);
    if (user?.role !== 'storeadmin' || !hasBusiness) {
      throw new Error('No tienes permiso para crear este perfil profesional.');
    }
    const name = typeof user?.name === 'string' ? user.name.trim() : '';
    if (!name)
      throw new Error('Actualiza tu nombre desde Editar perfil antes de añadirse al personal.');
    if (staffSnapshot.exists()) {
      throw new Error(
        'Tu perfil profesional ya existe. Actualiza la página e inténtalo nuevamente.',
      );
    }
    transaction.set(staffRef, {
      name,
      role: 'Staff',
      active: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    transaction.update(userRef, {
      staffId: uid,
      professionalBusinessId: businessId,
      updatedAt: serverTimestamp(),
    });
  });
}
