import 'dotenv/config';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

function getServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('Falta FIREBASE_SERVICE_ACCOUNT_JSON en .env');
  return JSON.parse(raw);
}

async function main() {
  if (getApps().length === 0) initializeApp({ credential: cert(getServiceAccount()) });
  const db = getFirestore();
  const businesses = await db.collection('barbers').get();
  let migrated = 0;

  for (const business of businesses.docs) {
    const services = await business.ref.collection('services').get();
    const batch = db.batch();
    let changes = 0;
    for (const service of services.docs) {
      if (typeof service.data().active !== 'boolean') {
        batch.update(service.ref, { active: true });
        changes += 1;
      }
    }
    if (changes > 0) await batch.commit();
    migrated += changes;
  }
  console.log(`Servicios heredados migrados con active: true: ${migrated}`);
}

main().catch((error) => { console.error('Error migrando servicios:', error); process.exit(1); });
