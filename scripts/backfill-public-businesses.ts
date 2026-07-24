import 'dotenv/config';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

function getServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('Falta FIREBASE_SERVICE_ACCOUNT_JSON en .env');
  return JSON.parse(raw);
}

function publicBusiness(data: Record<string, any>) {
  const config = data.config || {};
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
      ...(config.socialLinks ? { socialLinks: config.socialLinks } : {}),
      ...(config.theme ? { theme: config.theme } : {}),
      ...(config.booking ? { booking: config.booking } : {}),
    },
    workingHours: data.workingHours || {},
  };
}

async function main() {
  if (getApps().length === 0) initializeApp({ credential: cert(getServiceAccount()) });
  const db = getFirestore();
  const businesses = await db.collection('barbers').get();
  let batch = db.batch();
  let pending = 0;

  for (const business of businesses.docs) {
    batch.set(db.collection('publicBusinesses').doc(business.id), publicBusiness(business.data()));
    pending += 1;
    if (pending === 500) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending > 0) await batch.commit();
  console.log(`Proyecciones públicas actualizadas: ${businesses.size}`);
}

main().catch((error) => { console.error('Error creando proyecciones públicas:', error); process.exit(1); });
