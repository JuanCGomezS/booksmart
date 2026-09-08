import { updateProfile } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import {
  deleteObject,
  getBlob,
  ref,
  uploadBytesResumable,
  type UploadTask,
} from 'firebase/storage';
import { validateContentImage } from './content.ts';
import { auth, db, storage } from './firebase.ts';

const COLOMBIAN_PHONE = /^(?:\+?57)?3\d{9}$/;

export type PersonalProfileInput = {
  name: string;
  phone?: string;
  address?: string;
};

function normalizedPhone(value: string | undefined) {
  const phone = value?.trim() || '';
  if (!phone) return '';
  if (!COLOMBIAN_PHONE.test(phone.replace(/[\s()-]/g, '')))
    throw new Error('Ingresa un celular colombiano válido o déjalo vacío.');
  return phone;
}

function normalizedAddress(value: string | undefined) {
  const address = value?.trim() || '';
  if (address.length > 240) throw new Error('La dirección no puede superar 240 caracteres.');
  return address;
}

function requireCurrentUser(uid: string) {
  const user = auth.currentUser;
  if (!user || user.uid !== uid) throw new Error('Tu sesión cambió. Inténtalo de nuevo.');
  return user;
}

export async function updatePersonalProfile(uid: string, input: PersonalProfileInput) {
  const user = requireCurrentUser(uid);
  const name = input.name.trim();
  if (!name || name.length > 120) throw new Error('Ingresa un nombre de hasta 120 caracteres.');
  const phone = normalizedPhone(input.phone);
  const address = normalizedAddress(input.address);
  await updateDoc(doc(db, 'users', uid), {
    name,
    phone: phone || null,
    address: address || null,
    updatedAt: serverTimestamp(),
  });
  requireCurrentUser(uid);
  await updateProfile(user, { displayName: name });
}

export async function uploadPersonalProfilePhoto(
  uid: string,
  file: File,
  onProgress: (progress: number) => void,
  onTask?: (task: UploadTask | null) => void,
) {
  requireCurrentUser(uid);
  const validationError = validateContentImage(file);
  if (validationError) throw new Error(validationError);
  let extension = 'webp';
  if (file.type === 'image/jpeg') extension = 'jpg';
  if (file.type === 'image/png') extension = 'png';
  const profileRef = doc(db, 'users', uid);
  const profile = await getDoc(profileRef);
  requireCurrentUser(uid);
  const previousPath = profile.data()?.photoStoragePath;
  const path = `users/${uid}/profile/assets/${crypto.randomUUID()}.${extension}`;
  const imageRef = ref(storage, path);
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
  requireCurrentUser(uid);
  await updateDoc(profileRef, {
    photoStoragePath: path,
    updatedAt: serverTimestamp(),
  });
  if (typeof previousPath === 'string' && previousPath !== path)
    await deleteObject(ref(storage, previousPath));
  return path;
}

export async function loadPersonalProfilePhoto(uid: string, path: string) {
  requireCurrentUser(uid);
  const image = await getBlob(ref(storage, path));
  requireCurrentUser(uid);
  return URL.createObjectURL(image);
}
