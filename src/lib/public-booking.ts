import { collection, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import { isPublicBookingAvailable } from './booking';
import type {
  PublicBookingProduct,
  PublicBookingService,
  PublicBookingStaff,
  PublicBusiness,
} from './types';

/** Loads booking-only records after the server-authorized page bootstrap. */
export function loadPublicBookingConfiguration(
  business: PublicBusiness,
  products: PublicBookingProduct[],
  services: PublicBookingService[],
  staff: PublicBookingStaff[],
): {
  business: PublicBusiness;
  services: PublicBookingService[];
  staff: PublicBookingStaff[];
  products: PublicBookingProduct[];
} {
  if (!isPublicBookingAvailable(business))
    throw new Error('Business is not accepting public bookings.');

  return {
    business,
    services,
    staff,
    products,
  };
}

/** Reads only one staff member's non-PII locks for the selected Colombia-local date. */
export async function loadPublicDateLocks(
  businessId: string,
  bookingDate: string,
  staffId: string,
): Promise<Set<string>> {
  const snapshot = await getDocs(
    collection(
      db,
      'barbers',
      businessId,
      'bookingLocks',
      bookingDate,
      'staff',
      staffId,
      'intervals',
    ),
  );

  // The deterministic interval document ID is the only data availability needs.
  return new Set(snapshot.docs.map((item) => item.id));
}
