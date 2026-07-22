// `barbers` is the legacy Firestore subcollection name for staff. It must not
// be renamed even though the UI calls these records Personal.
export type ContentCollection = 'catalog' | 'products' | 'services' | 'barbers';
export type ContentImageExtension = 'jpg' | 'png' | 'webp';

export function createContentImageStoragePath(
  barberId: string,
  collectionName: ContentCollection,
  recordId: string,
  extension: ContentImageExtension,
  assetId = crypto.randomUUID(),
) {
  return `barbers/${barberId}/${collectionName}/${recordId}/assets/${assetId}.${extension}`;
}
