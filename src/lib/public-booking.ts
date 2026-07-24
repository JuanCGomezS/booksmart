import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebase';
import type { BarberStaff, Service } from './types';

/** Public booking configuration is queried only after the visitor opens booking. */
export async function loadPublicBookingConfiguration(businessId: string): Promise<{
  services: Service[];
  staff: BarberStaff[];
}> {
  const [servicesSnapshot, staffSnapshot] = await Promise.all([
    getDocs(query(collection(db, 'barbers', businessId, 'services'), where('active', '==', true))),
    getDocs(query(collection(db, 'barbers', businessId, 'barbers'), where('active', '==', true))),
  ]);

  return {
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
