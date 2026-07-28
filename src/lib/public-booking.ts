import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { PUBLIC_BUSINESSES_COLLECTION, readPublicBusiness } from './public-business';
import type { BarberStaff, PublicBusiness, Service } from './types';

/** Public booking configuration is queried only after the visitor opens booking. */
export async function loadPublicBookingConfiguration(businessId: string): Promise<{
  business: PublicBusiness;
  services: Service[];
  staff: BarberStaff[];
}> {
  const [businessSnapshot, servicesSnapshot, staffSnapshot] = await Promise.all([
    getDoc(doc(db, PUBLIC_BUSINESSES_COLLECTION, businessId)),
    getDocs(query(collection(db, 'barbers', businessId, 'services'), where('active', '==', true))),
    getDocs(query(collection(db, 'barbers', businessId, 'barbers'), where('active', '==', true))),
  ]);

  if (!businessSnapshot.exists()) throw new Error('Public booking policy is unavailable.');

  const business = readPublicBusiness(businessSnapshot.data(), businessSnapshot.id);
  if (!business.active) throw new Error('Business is not accepting public bookings.');

  return {
    business,
    services: servicesSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() } as Service)),
    staff: staffSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() } as BarberStaff)),
  };
}

/** Reads only one staff member's non-PII locks for the selected Colombia-local date. */
export async function loadPublicDateLocks(
  businessId: string,
  bookingDate: string,
  staffId: string,
): Promise<Set<string>> {
  const snapshot = await getDocs(collection(
    db,
    'barbers', businessId,
    'bookingLocks', bookingDate,
    'staff', staffId,
    'intervals',
  ));

  // The deterministic interval document ID is the only data availability needs.
  return new Set(snapshot.docs.map((item) => item.id));
}
