import 'dotenv/config';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { normalizeBusinessCoordinates, normalizeLegacyPlaceUrl, normalizeWorkingHours } from '../src/lib/public-business';

function getServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('Falta FIREBASE_SERVICE_ACCOUNT_JSON en .env');
  return JSON.parse(raw);
}

function publicBusiness(data: Record<string, any>) {
  const config = data.config || {};
  const location = normalizeBusinessCoordinates(config.location);
  const placeUrl = normalizeLegacyPlaceUrl(config.placeUrl);
  return {
    name: String(data.name || ''),
    slug: String(data.slug || ''),
    businessType: data.businessType || 'barbershop',
    active: data.active === true,
    config: {
      address: String(config.address || ''),
      phone: String(config.phone || ''),
      ...(config.logoUrl ? { logoUrl: config.logoUrl } : {}),
      ...(config.coverUrl ? { coverUrl: config.coverUrl } : {}),
      ...(placeUrl ? { placeUrl } : {}),
      ...(location ? { location } : {}),
      ...(config.socialLinks ? { socialLinks: config.socialLinks } : {}),
      ...(config.theme ? { theme: config.theme } : {}),
      ...(config.booking ? { booking: config.booking } : {}),
    },
    workingHours: normalizeWorkingHours(data.workingHours),
  };
}

function legacyBrandingMetadata(data: Record<string, any>) {
  const config = data.config || {};
  const pendingImageCleanupPaths = Array.isArray(config.pendingBrandingCleanupPaths)
    ? [...new Set(config.pendingBrandingCleanupPaths.filter((path: unknown): path is string => typeof path === 'string' && Boolean(path)))]
    : [];
  return {
    ...(typeof config.logoStoragePath === 'string' && config.logoStoragePath ? { logoStoragePath: config.logoStoragePath } : {}),
    ...(typeof config.coverStoragePath === 'string' && config.coverStoragePath ? { coverStoragePath: config.coverStoragePath } : {}),
    ...(pendingImageCleanupPaths.length ? { pendingImageCleanupPaths } : {}),
  };
}

async function main() {
  if (getApps().length === 0) initializeApp({ credential: cert(getServiceAccount()) });
  const db = getFirestore();
  const businesses = await db.collection('barbers').get();
  let reconciled = 0;
  let skipped = 0;

  for (const business of businesses.docs) {
    const barberRef = db.collection('barbers').doc(business.id);
    const publicRef = db.collection('publicBusinesses').doc(business.id);
    const metadataRef = barberRef.collection('brandingMetadata').doc('assets');
    const outcome = await db.runTransaction(async (transaction) => {
      // Reading both source and projection makes Firestore retry this reconciliation
      // if an admin save changes either document while the backfill is running.
      const [rootSnapshot, , metadataSnapshot] = await Promise.all([
        transaction.get(barberRef),
        transaction.get(publicRef),
        transaction.get(metadataRef),
      ]);
      if (!rootSnapshot.exists) {
        return 'skipped';
      }

      const metadata = legacyBrandingMetadata(rootSnapshot.data());
      transaction.set(publicRef, publicBusiness(rootSnapshot.data()));
      if (Object.keys(metadata).length) {
        const existing = metadataSnapshot.data() || {};
        const existingCleanupPaths: string[] = Array.isArray(existing.pendingImageCleanupPaths)
          ? existing.pendingImageCleanupPaths.filter((path: unknown): path is string => typeof path === 'string')
          : [];
        const pendingImageCleanupPaths: string[] = Array.isArray(metadata.pendingImageCleanupPaths)
          ? metadata.pendingImageCleanupPaths.filter((path: unknown): path is string => typeof path === 'string' && !existingCleanupPaths.includes(path))
          : [];
        transaction.set(metadataRef, {
          ...(existing.logoStoragePath ? {} : metadata.logoStoragePath ? { logoStoragePath: metadata.logoStoragePath } : {}),
          ...(existing.coverStoragePath ? {} : metadata.coverStoragePath ? { coverStoragePath: metadata.coverStoragePath } : {}),
          ...(pendingImageCleanupPaths.length ? { pendingImageCleanupPaths: FieldValue.arrayUnion(...pendingImageCleanupPaths) } : {}),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      return 'reconciled';
    });
    if (outcome === 'reconciled') reconciled += 1;
    else skipped += 1;
  }
  console.log(`Proyecciones públicas reconciliadas: ${reconciled}; negocios omitidos: ${skipped}`);
}

main().catch((error) => { console.error('Error creando proyecciones públicas:', error); process.exit(1); });
