import { deleteField, doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytesResumable,
  type UploadTask,
} from 'firebase/storage';
import { db, storage } from './firebase';
import { invalidatePublicBusinessCaches } from './barbers';
import { isAlreadyMissingStorageObject } from './content-cleanup';
import { normalizeBusinessCoordinates, PUBLIC_BUSINESSES_COLLECTION } from './public-business';
import { themeForPersistence, type CustomThemePalette, type PublicThemeId } from './public-theme';
import type { BusinessCoordinates, BusinessType } from './types';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type BrandingSlot = 'logo' | 'cover';
export type BrandingUploadProgress = Partial<Record<BrandingSlot, number>>;
export type BrandingUploadTaskHandler = (task: UploadTask | null) => void;

type BusinessDetails = {
  name: string;
  businessType: BusinessType;
  address: string;
  location?: BusinessCoordinates;
  phone: string;
  instagram: string;
  facebook: string;
  whatsapp: string;
  publicThemeId: PublicThemeId;
  customThemePalette: CustomThemePalette;
};

type BrandingFiles = Partial<Record<BrandingSlot, File | null>>;

export function validateBusinessBrandingImage(file: File) {
  if (!IMAGE_TYPES.has(file.type)) return 'Elija una imagen JPEG, PNG o WebP.';
  if (file.size > MAX_IMAGE_BYTES) return 'La imagen no puede superar 5 MiB.';
  return '';
}

function extensionFor(file: File) {
  return file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : 'webp';
}

function createBrandingPath(barberId: string, slot: BrandingSlot, file: File) {
  return `barbers/${barberId}/branding/${slot}/assets/${crypto.randomUUID()}.${extensionFor(file)}`;
}

async function deleteBrandingObject(path: string) {
  try {
    await deleteObject(ref(storage, path));
  } catch (error) {
    if (isAlreadyMissingStorageObject(error)) return;
    throw error;
  }
}

async function uploadBrandingImage(
  barberId: string,
  slot: BrandingSlot,
  file: File,
  onProgress: (progress: number) => void,
  onTask: BrandingUploadTaskHandler,
) {
  const validationError = validateBusinessBrandingImage(file);
  if (validationError) throw new Error(validationError);

  const path = createBrandingPath(barberId, slot, file);
  const imageRef = ref(storage, path);
  await new Promise<void>((resolve, reject) => {
    const task = uploadBytesResumable(imageRef, file, { contentType: file.type });
    onTask(task);
    task.on(
      'state_changed',
      (snapshot) => onProgress(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)),
      (error) => {
        onTask(null);
        reject(error);
      },
      () => {
        onTask(null);
        resolve();
      },
    );
  });

  try {
    return { url: await getDownloadURL(imageRef), path };
  } catch (error) {
    await deleteBrandingObject(path);
    throw error;
  }
}

/**
 * Updates the canonical business and its public projection in one atomic batch.
 */
export async function saveBusinessDetails(
  barberId: string,
  details: BusinessDetails,
  files: BrandingFiles,
  onProgress: (progress: BrandingUploadProgress) => void,
  onUploadTask: BrandingUploadTaskHandler,
): Promise<void> {
  const barberRef = doc(db, 'barbers', barberId);
  const publicRef = doc(db, PUBLIC_BUSINESSES_COLLECTION, barberId);
  const location = normalizeBusinessCoordinates(details.location);
  const theme = themeForPersistence(details.publicThemeId, details.customThemePalette);
  if (!theme.theme) throw new Error(theme.error || 'No se pudo validar el tema personalizado.');
  const uploaded: Partial<Record<BrandingSlot, { url: string; path: string }>> = {};
  try {
    for (const slot of ['logo', 'cover'] as BrandingSlot[]) {
      const file = files[slot];
      if (!file) continue;
      uploaded[slot] = await uploadBrandingImage(
        barberId,
        slot,
        file,
        (progress) => onProgress({ [slot]: progress }),
        onUploadTask,
      );
    }

    const valueOrDelete = (value: string) => value.trim() || deleteField();
    const publicUpdates = {
      name: details.name.trim(),
      businessType: details.businessType,
      'config.address': details.address.trim(),
      'config.location': location || deleteField(),
      'config.phone': details.phone.trim(),
      'config.socialLinks.instagram': valueOrDelete(details.instagram),
      'config.socialLinks.facebook': valueOrDelete(details.facebook),
      'config.socialLinks.whatsapp': valueOrDelete(details.whatsapp),
      'config.theme': theme.theme,
      ...(uploaded.logo ? { 'config.logoUrl': uploaded.logo.url } : {}),
      ...(uploaded.cover ? { 'config.coverUrl': uploaded.cover.url } : {}),
    };
    const batch = writeBatch(db);
    batch.update(barberRef, { ...publicUpdates, updatedAt: serverTimestamp() });
    batch.update(publicRef, publicUpdates);
    await batch.commit();
    invalidatePublicBusinessCaches(barberId);
  } catch (error) {
    await Promise.all(
      Object.values(uploaded).map(async (image) => {
        if (!image) return;
        try {
          await deleteBrandingObject(image.path);
        } catch (cleanupError) {
          console.warn('No se pudo limpiar una imagen de marca no guardada.', cleanupError);
        }
      }),
    );
    throw error;
  }
}
