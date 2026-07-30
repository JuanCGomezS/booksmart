import { arrayRemove, arrayUnion, deleteField, doc, getDoc, runTransaction, serverTimestamp, updateDoc } from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytesResumable, type UploadTask } from 'firebase/storage';
import { db, storage } from './firebase';
import { invalidatePublicBusinessCaches } from './barbers';
import { isAlreadyMissingStorageObject, retryPendingCleanup } from './content-cleanup';
import { normalizeBusinessCoordinates, normalizeLegacyPlaceUrl, normalizeWorkingHours, PUBLIC_BUSINESSES_COLLECTION } from './public-business';
import type { Barber, BusinessCoordinates, BusinessType } from './types';
import type { PublicThemeId } from './public-theme';

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
  workingHours?: Barber['workingHours'];
};

type BrandingFiles = Partial<Record<BrandingSlot, File | null>>;
type BrandingAssetMetadata = {
  logoStoragePath?: string;
  coverStoragePath?: string;
  pendingImageCleanupPaths?: string[];
};

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

async function uploadBrandingImage(barberId: string, slot: BrandingSlot, file: File, onProgress: (progress: number) => void, onTask: BrandingUploadTaskHandler) {
  const validationError = validateBusinessBrandingImage(file);
  if (validationError) throw new Error(validationError);

  const path = createBrandingPath(barberId, slot, file);
  const imageRef = ref(storage, path);
  await new Promise<void>((resolve, reject) => {
    const task = uploadBytesResumable(imageRef, file, { contentType: file.type });
    onTask(task);
    task.on('state_changed', (snapshot) => onProgress(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)), (error) => {
      onTask(null);
      reject(error);
    }, () => {
      onTask(null);
      resolve();
    });
  });

  try {
    return { url: await getDownloadURL(imageRef), path };
  } catch (error) {
    await deleteBrandingObject(path);
    throw error;
  }
}

function brandingMetadataRef(barberId: string) {
  return doc(db, 'barbers', barberId, 'brandingMetadata', 'assets');
}

function readBrandingAssetMetadata(data: Record<string, unknown> | undefined): BrandingAssetMetadata {
  return {
    ...(typeof data?.logoStoragePath === 'string' ? { logoStoragePath: data.logoStoragePath } : {}),
    ...(typeof data?.coverStoragePath === 'string' ? { coverStoragePath: data.coverStoragePath } : {}),
    ...(Array.isArray(data?.pendingImageCleanupPaths)
      ? { pendingImageCleanupPaths: data.pendingImageCleanupPaths.filter((path): path is string => typeof path === 'string') }
      : {}),
  };
}

async function retryPendingBrandingCleanup(barberId: string): Promise<void> {
  const metadataRef = brandingMetadataRef(barberId);
  const snapshot = await getDoc(metadataRef);
  if (!snapshot.exists()) return;

  try {
    await retryPendingCleanup([{ id: snapshot.id, ...readBrandingAssetMetadata(snapshot.data()) }], {
      deletePath: deleteBrandingObject,
      clearPath: (_recordId, path) => updateDoc(metadataRef, {
        pendingImageCleanupPaths: arrayRemove(path),
        updatedAt: serverTimestamp(),
      }),
    });
  } catch (error) {
    console.warn('No se pudo completar toda la limpieza pendiente de imágenes de marca.', error);
  }
}

/**
 * Updates private branding metadata and the public projection atomically.
 * Storeadmins read the projection and dedicated branding metadata only.
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
  await retryPendingBrandingCleanup(barberId);
  const location = normalizeBusinessCoordinates(details.location);

  const uploaded: Partial<Record<BrandingSlot, { url: string; path: string }>> = {};
  try {
    for (const slot of ['logo', 'cover'] as BrandingSlot[]) {
      const file = files[slot];
      if (!file) continue;
      uploaded[slot] = await uploadBrandingImage(barberId, slot, file, (progress) => onProgress({ [slot]: progress }), onUploadTask);
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
      'config.theme.id': details.publicThemeId,
      ...(uploaded.logo ? { 'config.logoUrl': uploaded.logo.url } : {}),
      ...(uploaded.cover ? { 'config.coverUrl': uploaded.cover.url } : {}),
      workingHours: normalizeWorkingHours(details.workingHours),
    };
    const rootUpdates = {
      name: details.name.trim(),
      businessType: details.businessType,
      'config.address': details.address.trim(),
      'config.location': location || deleteField(),
      'config.phone': details.phone.trim(),
      'config.socialLinks.instagram': valueOrDelete(details.instagram),
      'config.socialLinks.facebook': valueOrDelete(details.facebook),
      'config.socialLinks.whatsapp': valueOrDelete(details.whatsapp),
      'config.theme.id': details.publicThemeId,
      ...(uploaded.logo ? { 'config.logoUrl': uploaded.logo.url } : {}),
      ...(uploaded.cover ? { 'config.coverUrl': uploaded.cover.url } : {}),
      workingHours: normalizeWorkingHours(details.workingHours),
      updatedAt: serverTimestamp(),
    };
    await runTransaction(db, async (transaction) => {
      const metadataRef = brandingMetadataRef(barberId);
      const [publicSnapshot, metadataSnapshot] = await Promise.all([
        transaction.get(publicRef),
        transaction.get(metadataRef),
      ]);
      if (!publicSnapshot.exists()) throw new Error('No se encontró la información pública del negocio. Actualice la página e inténtelo nuevamente.');

      const metadata = readBrandingAssetMetadata(metadataSnapshot.data());
      const replacedPaths = [
        ...(uploaded.logo && metadata.logoStoragePath ? [metadata.logoStoragePath] : []),
        ...(uploaded.cover && metadata.coverStoragePath ? [metadata.coverStoragePath] : []),
      ];
      const placeUrl = normalizeLegacyPlaceUrl(publicSnapshot.data().config?.placeUrl);
      transaction.update(barberRef, rootUpdates);
      transaction.update(publicRef, {
        ...publicUpdates,
        'config.placeUrl': placeUrl || deleteField(),
      });
      transaction.set(metadataRef, {
        ...(uploaded.logo ? { logoStoragePath: uploaded.logo.path } : {}),
        ...(uploaded.cover ? { coverStoragePath: uploaded.cover.path } : {}),
        ...(replacedPaths.length ? { pendingImageCleanupPaths: arrayUnion(...replacedPaths) } : {}),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    });
    invalidatePublicBusinessCaches(barberId);
    await retryPendingBrandingCleanup(barberId);
  } catch (error) {
    await Promise.all(Object.values(uploaded).map(async (image) => {
      if (!image) return;
      try {
        await deleteBrandingObject(image.path);
      } catch (cleanupError) {
        console.warn('No se pudo limpiar una imagen de marca no guardada.', cleanupError);
      }
    }));
    throw error;
  }
}
