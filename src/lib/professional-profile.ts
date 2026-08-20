import { doc, getDoc, runTransaction, serverTimestamp, updateDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytesResumable, type UploadTask } from 'firebase/storage';
import { db, storage } from './firebase';
import { validateContentImage } from './content';
import { createContentImageStoragePath, type ContentImageExtension } from './content-image-path';

const immutableImageName =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

function isOwnProfessionalPhotoPath(businessId: string, uid: string, path: string) {
  const segments = path.split('/');
  return (
    segments[0] === 'barbers' &&
    segments[1] === businessId &&
    segments[2] === 'barbers' &&
    segments[3] === uid &&
    ((segments.length === 5 && /^image\.(jpg|png|webp)$/.test(segments[4])) ||
      (segments.length === 6 && segments[4] === 'assets' && immutableImageName.test(segments[5])))
  );
}

function extensionFor(file: File): ContentImageExtension {
  return file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : 'webp';
}

function profileRef(businessId: string, uid: string) {
  return doc(db, 'barbers', businessId, 'barbers', uid);
}

/** Creates the Storeadmin's optional, deterministic professional profile. */
export async function createOwnStoreadminProfessionalProfile(
  businessId: string,
  uid: string,
  name: string,
) {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error('Ingresa el nombre que verán los clientes.');

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
    if (staffSnapshot.exists()) {
      throw new Error(
        'Tu perfil profesional ya existe. Actualiza la página e inténtalo nuevamente.',
      );
    }
    transaction.set(staffRef, {
      name: trimmedName,
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

export async function updateOwnProfessionalName(businessId: string, uid: string, name: string) {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error('Ingresa el nombre que verán los clientes.');
  await updateDoc(profileRef(businessId, uid), { name: trimmedName, updatedAt: serverTimestamp() });
}

/** Replaces an own-profile photo through an immutable, UID-bound Storage path. */
export async function replaceOwnProfessionalPhoto(
  businessId: string,
  uid: string,
  file: File,
  onProgress: (progress: number) => void,
  onTask?: (task: UploadTask | null) => void,
) {
  const validationError = validateContentImage(file);
  if (validationError) throw new Error(validationError);

  const path = createContentImageStoragePath(businessId, 'barbers', uid, extensionFor(file));
  const imageRef = ref(storage, path);
  const recordRef = profileRef(businessId, uid);
  const current = await getDoc(recordRef);
  if (!current.exists())
    throw new Error(
      'Tu perfil profesional ya no existe. Actualiza la página e inténtalo nuevamente.',
    );
  const currentPendingCleanupPaths = Array.isArray(current.data().pendingImageCleanupPaths)
    ? current
        .data()
        .pendingImageCleanupPaths.filter((value): value is string => typeof value === 'string')
    : [];
  const oldPath =
    typeof current.data().imageStoragePath === 'string'
      ? current.data().imageStoragePath
      : undefined;
  const cleanupPath =
    oldPath && isOwnProfessionalPhotoPath(businessId, uid, oldPath) ? oldPath : undefined;

  // Register the upload before it exists. If a later client step fails, the
  // retired-profile cleanup flow can safely resolve this exact immutable path.
  await updateDoc(recordRef, {
    pendingImageCleanupPaths: [...new Set([...currentPendingCleanupPaths, path])],
    updatedAt: serverTimestamp(),
  });
  await new Promise<void>((resolve, reject) => {
    const task = uploadBytesResumable(imageRef, file, { contentType: file.type });
    onTask?.(task);
    task.on(
      'state_changed',
      (snapshot) => onProgress(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)),
      (error) => {
        onTask?.(null);
        reject(error);
      },
      () => {
        onTask?.(null);
        resolve();
      },
    );
  });
  const photoUrl = await getDownloadURL(imageRef);
  await updateDoc(recordRef, {
    photoUrl,
    imageStoragePath: path,
    pendingImageCleanupPaths: [
      ...new Set([
        ...currentPendingCleanupPaths,
        ...(cleanupPath && cleanupPath !== path ? [cleanupPath] : []),
      ]),
    ].filter((pendingPath) => pendingPath !== path),
    updatedAt: serverTimestamp(),
  });
}
