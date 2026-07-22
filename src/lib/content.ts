import { arrayRemove, arrayUnion, collection, deleteDoc, deleteField, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytesResumable, type UploadTask } from 'firebase/storage';
import { db, storage } from './firebase';
import { createContentImageStoragePath, type ContentCollection, type ContentImageExtension } from './content-image-path';
import { deleteWithDurableCleanup, isAlreadyMissingStorageObject, replaceWithDurableCleanup, retryPendingCleanup } from './content-cleanup';
import type { BarberStaff, CatalogItem, Product, Service } from './types';

export type { ContentCollection } from './content-image-path';
export type ContentRecord = CatalogItem | Product | Service | BarberStaff;

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
type MutationOptions = {
  recordId?: string;
  onUploadTask?: (task: UploadTask | null) => void;
  imageField?: 'imageUrl' | 'photoUrl';
};

export function validateContentImage(file: File) {
  if (!IMAGE_TYPES.has(file.type)) return 'Elegí una imagen JPEG, PNG o WebP.';
  if (file.size > MAX_IMAGE_BYTES) return 'La imagen no puede superar 5 MiB.';
  return '';
}

function extensionFor(file: File): ContentImageExtension {
  return file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : 'webp';
}

function clearPublicCache(barberId: string, collectionName: ContentCollection) {
  const cacheKey: Record<ContentCollection, string> = {
    catalog: `barber_catalog_${barberId}`,
    products: `barber_products_${barberId}`,
    services: `barber_services_${barberId}`,
    barbers: `barber_staff_${barberId}`,
  };
  localStorage.removeItem(cacheKey[collectionName]);
  localStorage.removeItem(`barber_metrics_${barberId}`);
}

function cleanupError(path: string) {
  return new Error(`No se pudo limpiar la imagen de Storage (${path}). El registro se conservó y la limpieza se reintentará al volver a cargar o modificar este contenido.`);
}

export function allocateContentRecordId(barberId: string, collectionName: ContentCollection) {
  return doc(collection(db, 'barbers', barberId, collectionName)).id;
}

export async function getContentCollection<T extends ContentRecord>(barberId: string, collectionName: ContentCollection): Promise<T[]> {
  const snapshot = await getDocs(collection(db, 'barbers', barberId, collectionName));
  const records = snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as T));
  await retryPendingContentCleanup(barberId, collectionName, records);
  return records;
}

async function uploadContentImage(
  barberId: string,
  collectionName: ContentCollection,
  recordId: string,
  file: File,
  onProgress: (progress: number) => void,
  onUploadTask?: (task: UploadTask | null) => void,
) {
  const validationError = validateContentImage(file);
  if (validationError) throw new Error(validationError);

  const path = createContentImageStoragePath(barberId, collectionName, recordId, extensionFor(file));
  const imageRef = ref(storage, path);
  await new Promise<void>((resolve, reject) => {
    const task = uploadBytesResumable(imageRef, file, { contentType: file.type });
    onUploadTask?.(task);
    task.on('state_changed', (snapshot) => onProgress(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)), (error) => {
      onUploadTask?.(null);
      reject(error);
    }, () => {
      onUploadTask?.(null);
      resolve();
    });
  });

  try {
    return { imageUrl: await getDownloadURL(imageRef), imageStoragePath: path };
  } catch (error) {
    await deleteStorageObject(path);
    throw error;
  }
}

export async function deleteStorageObject(path: string | undefined) {
  if (!path) return;
  try {
    await deleteObject(ref(storage, path));
  } catch (error) {
    if (isAlreadyMissingStorageObject(error)) return;
    console.warn(`No se pudo limpiar la imagen de Storage (${path}).`, error);
    throw cleanupError(path);
  }
}

export async function createContentRecord(
  barberId: string,
  collectionName: ContentCollection,
  data: Record<string, unknown>,
  image: File | null,
  onProgress: (progress: number) => void,
  options: MutationOptions = {},
) {
  await retryPendingContentCleanupForMutation(barberId, collectionName);
  const recordRef = doc(db, 'barbers', barberId, collectionName, options.recordId || allocateContentRecordId(barberId, collectionName));
  let uploadedPath: string | undefined;

  try {
    const uploadedImage = image
      ? await uploadContentImage(barberId, collectionName, recordRef.id, image, onProgress, options.onUploadTask)
      : undefined;
    const imageData = uploadedImage && options.imageField === 'photoUrl'
      ? { photoUrl: uploadedImage.imageUrl, imageStoragePath: uploadedImage.imageStoragePath }
      : uploadedImage || {};
    uploadedPath = uploadedImage?.imageStoragePath;
    await setDoc(recordRef, { ...data, ...imageData, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    clearPublicCache(barberId, collectionName);
    return recordRef.id;
  } catch (error) {
    await deleteStorageObject(uploadedPath);
    throw error;
  }
}

export async function updateContentRecord(barberId: string, collectionName: ContentCollection, recordId: string, data: Record<string, unknown>) {
  await retryPendingContentCleanupForMutation(barberId, collectionName);
  await updateDoc(doc(db, 'barbers', barberId, collectionName, recordId), { ...data, updatedAt: serverTimestamp() });
  clearPublicCache(barberId, collectionName);
}

export async function replaceContentImage(
  barberId: string,
  collectionName: ContentCollection,
  record: ContentRecord,
  file: File,
  onProgress: (progress: number) => void,
  imageField: 'imageUrl' | 'photoUrl' = 'imageUrl',
) {
  await retryPendingContentCleanupForMutation(barberId, collectionName);
  const recordRef = doc(db, 'barbers', barberId, collectionName, record.id);
  await replaceWithDurableCleanup({
    upload: () => uploadContentImage(barberId, collectionName, record.id, file, onProgress),
    getOldPath: async () => {
      const currentRecord = await getDoc(recordRef);
      if (!currentRecord.exists()) throw new Error('El registro ya no existe. Actualizá el contenido antes de reintentar.');
      return (currentRecord.data() as ContentRecord).imageStoragePath;
    },
    commit: async (imageData, pendingOldPath) => {
      const recordImage = imageField === 'photoUrl'
        ? { photoUrl: imageData.imageUrl, imageStoragePath: imageData.imageStoragePath }
        : imageData;
      await updateDoc(recordRef, {
        ...recordImage,
        ...(pendingOldPath ? { pendingImageCleanupPaths: arrayUnion(pendingOldPath) } : {}),
        updatedAt: serverTimestamp(),
      });
      clearPublicCache(barberId, collectionName);
    },
    deleteOld: (path) => deleteStorageObject(path),
    clearPendingOld: (path) => updateDoc(recordRef, { pendingImageCleanupPaths: arrayRemove(path) }),
    deleteNew: (imageData) => deleteStorageObject(imageData.imageStoragePath),
  });
}

export async function deleteContentRecord(barberId: string, collectionName: ContentCollection, record: ContentRecord) {
  await retryPendingContentCleanupForMutation(barberId, collectionName);
  const recordRef = doc(db, 'barbers', barberId, collectionName, record.id);
  await deleteWithDurableCleanup([record.imageStoragePath, ...(record.pendingImageCleanupPaths || [])], {
    deletePath: deleteStorageObject,
    clearPath: (path) => updateDoc(recordRef, {
      ...(record.imageStoragePath === path ? { imageStoragePath: deleteField() } : {}),
      pendingImageCleanupPaths: arrayRemove(path),
      updatedAt: serverTimestamp(),
    }),
    deleteRecord: () => deleteDoc(recordRef),
  });
  clearPublicCache(barberId, collectionName);
}

async function retryPendingContentCleanupForMutation(barberId: string, collectionName: ContentCollection) {
  const snapshot = await getDocs(collection(db, 'barbers', barberId, collectionName));
  const records = snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as ContentRecord));
  await retryPendingContentCleanup(barberId, collectionName, records);
}

async function retryPendingContentCleanup(barberId: string, collectionName: ContentCollection, records: ContentRecord[]) {
  try {
    await retryPendingCleanup(records, {
      deletePath: (path) => deleteStorageObject(path),
      clearPath: (recordId, path) => updateDoc(doc(db, 'barbers', barberId, collectionName, recordId), {
        pendingImageCleanupPaths: arrayRemove(path), updatedAt: serverTimestamp(),
      }),
    });
  } catch (error) {
    console.warn('No se pudo completar toda la limpieza pendiente de Storage.', error);
  }
}
