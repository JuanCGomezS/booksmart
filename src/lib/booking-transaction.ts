import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
  type DocumentReference,
  type Firestore,
  type Transaction,
} from 'firebase/firestore';
import { checkBookingAvailability, getBookingLockIntervals } from './booking';
import { PUBLIC_BUSINESSES_COLLECTION } from './public-business';
import { auth } from './firebase';
import type { BarberStaff, BookingSettings, PublicBusiness, Service } from './types';

export const BOOKING_CONFLICT_MESSAGE = 'Ese horario acaba de ser ocupado. Por favor, elige otra hora.';
export const BOOKING_UNAVAILABLE_MESSAGE = 'Ese horario ya no está disponible. Por favor, elige otra hora.';
export const BOOKING_PERMISSION_MESSAGE = 'No tenemos permiso para confirmar la reserva. Inténtalo nuevamente.';
export const BOOKING_NETWORK_MESSAGE = 'No pudimos conectar para confirmar la reserva. Revisa tu conexión e inténtalo nuevamente.';
export const BOOKING_PRECONDITION_MESSAGE = 'La reserva cambió antes de confirmarse. Actualiza la página e inténtalo nuevamente.';
export const BOOKING_ERROR_MESSAGE = 'No pudimos confirmar la reserva. Inténtalo nuevamente.';

export interface PublicBookingConfiguration {
  business: Pick<PublicBusiness, 'active' | 'workingHours'> & { config: { booking?: BookingSettings } };
  service: Pick<Service, 'id' | 'active' | 'duration' | 'bufferMinutes' | 'staffIds'>;
  staff: Pick<BarberStaff, 'id' | 'active' | 'schedule'>;
}

export interface ClientBookingRequest {
  businessId: string;
  bookingDate: string;
  startTime: string;
  clientName: string;
  clientPhone: string;
  notes?: string;
}

export type ClientBookingResult =
  | { ok: true; appointmentId: string }
  | { ok: false; code: 'conflict' | 'unavailable' | 'permission_denied' | 'network' | 'failed_precondition' | 'error'; message: string };

export interface BookingSnapshot<T> {
  exists(): boolean;
  data(): T | undefined;
}

export interface BookingTransactionAdapter<Reference> {
  run<T>(update: (transaction: {
    get<T>(reference: Reference): Promise<BookingSnapshot<T>>;
    set(reference: Reference, value: Record<string, unknown>): void;
  }) => Promise<T>): Promise<T>;
}

export interface BookingReferenceFactory<Reference> {
  business(businessId: string): Reference;
  service(businessId: string, serviceId: string): Reference;
  staff(businessId: string, staffId: string): Reference;
  appointment(businessId: string): Reference & { id: string };
  lock(businessId: string, bookingDate: string, staffId: string, intervalId: string): Reference;
}

export interface BookingAdapters<Reference> {
  transaction: BookingTransactionAdapter<Reference>;
  references: BookingReferenceFactory<Reference>;
}

class BookingConflictError extends Error {
  constructor() {
    super(BOOKING_CONFLICT_MESSAGE);
    this.name = 'BookingConflictError';
  }
}

function firebaseAdapters(firestore: Firestore): BookingAdapters<DocumentReference> {
  return {
    transaction: {
      run: (update) => runTransaction(firestore, (transaction: Transaction) => update(transaction as unknown as Parameters<typeof update>[0])),
    },
    references: {
      business: (businessId) => doc(firestore, PUBLIC_BUSINESSES_COLLECTION, businessId),
      service: (businessId, serviceId) => doc(firestore, 'barbers', businessId, 'services', serviceId),
      staff: (businessId, staffId) => doc(firestore, 'barbers', businessId, 'barbers', staffId),
      appointment: (businessId) => doc(collection(firestore, 'barbers', businessId, 'appointments')),
      lock: (businessId, bookingDate, staffId, intervalId) => doc(
        firestore,
        'barbers', businessId, 'bookingLocks', bookingDate, 'staff', staffId, 'intervals', intervalId,
      ),
    },
  };
}

function firestoreErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function errorResult(error: unknown): ClientBookingResult {
  if (error instanceof BookingConflictError || ['aborted', 'already-exists', 'conflict'].includes(firestoreErrorCode(error) || '')) {
    return { ok: false, code: 'conflict', message: BOOKING_CONFLICT_MESSAGE };
  }

  switch (firestoreErrorCode(error)) {
    case 'permission-denied':
    case 'unauthenticated':
      return { ok: false, code: 'permission_denied', message: BOOKING_PERMISSION_MESSAGE };
    case 'unavailable':
    case 'deadline-exceeded':
    case 'network-request-failed':
      return { ok: false, code: 'network', message: BOOKING_NETWORK_MESSAGE };
    case 'failed-precondition':
      return { ok: false, code: 'failed_precondition', message: BOOKING_PRECONDITION_MESSAGE };
    default:
      return { ok: false, code: 'error', message: BOOKING_ERROR_MESSAGE };
  }
}

/**
 * Revalidates the current public business, selected service, and selected staff
 * inside the transaction before writing the private appointment and its locks.
 * It reads only those three documents plus the requested date's deterministic locks.
 */
export async function createClientBooking<Reference = DocumentReference>(
  request: ClientBookingRequest,
  _loadedConfiguration: PublicBookingConfiguration,
  options: { firestore?: Firestore; now?: Date; adapters?: BookingAdapters<Reference> } = {},
): Promise<ClientBookingResult> {
  const adapters = options.adapters || firebaseAdapters(
    options.firestore || (await import('./firebase')).db,
  ) as unknown as BookingAdapters<Reference>;
  const { references } = adapters;
  const appointmentRef = references.appointment(request.businessId);

  try {
    return await adapters.transaction.run(async (transaction) => {
      const [businessSnapshot, serviceSnapshot, staffSnapshot] = await Promise.all([
        transaction.get<PublicBookingConfiguration['business']>(references.business(request.businessId)),
        transaction.get<PublicBookingConfiguration['service']>(references.service(request.businessId, _loadedConfiguration.service.id)),
        transaction.get<PublicBookingConfiguration['staff']>(references.staff(request.businessId, _loadedConfiguration.staff.id)),
      ]);
      if (!businessSnapshot.exists() || !serviceSnapshot.exists() || !staffSnapshot.exists()) {
        return { ok: false, code: 'unavailable', message: BOOKING_UNAVAILABLE_MESSAGE };
      }

      const business = businessSnapshot.data();
      const service = serviceSnapshot.data();
      const staff = staffSnapshot.data();
      if (!business || !service || !staff) return { ok: false, code: 'unavailable', message: BOOKING_UNAVAILABLE_MESSAGE };

      const availability = checkBookingAvailability({
        business,
        service,
        staff,
        staffId: _loadedConfiguration.staff.id,
        bookingDate: request.bookingDate,
        startTime: request.startTime,
        now: options.now,
      });
      if (!availability.available) return { ok: false, code: 'unavailable', message: BOOKING_UNAVAILABLE_MESSAGE };

      const settings = business.config.booking;
      const intervals = getBookingLockIntervals(
        request.startTime,
        service.duration,
        service.bufferMinutes || 0,
        settings?.slotIntervalMinutes || 30,
      );
      if (!intervals?.length) return { ok: false, code: 'unavailable', message: BOOKING_UNAVAILABLE_MESSAGE };

      const lockRefs = intervals.map((interval) => references.lock(
        request.businessId, request.bookingDate, _loadedConfiguration.staff.id, interval.id,
      ));
      const lockSnapshots = await Promise.all(lockRefs.map((lockRef) => transaction.get(lockRef)));
      if (lockSnapshots.some((snapshot) => snapshot.exists())) throw new BookingConflictError();

      transaction.set(appointmentRef, {
        clientName: request.clientName.trim(), clientPhone: request.clientPhone.trim(), barberId: _loadedConfiguration.staff.id,
        serviceId: _loadedConfiguration.service.id, extraServices: [], bookingDate: request.bookingDate,
        startTime: request.startTime, endTime: availability.endTime, occupiedIntervalIds: intervals.map((interval) => interval.id),
        primaryLockId: intervals[0].id, status: 'pending',
        ...(request.notes?.trim() ? { notes: request.notes.trim() } : {}),
        ...(auth.currentUser ? { customerUid: auth.currentUser.uid } : {}),
        createdAt: serverTimestamp(),
      });
      lockRefs.forEach((lockRef, index) => {
        const interval = intervals[index];
        transaction.set(lockRef, {
          appointmentId: appointmentRef.id, bookingDate: request.bookingDate, staffId: _loadedConfiguration.staff.id,
          intervalId: interval.id, startTime: interval.startTime, endTime: interval.endTime, createdAt: serverTimestamp(),
        });
      });
      return { ok: true, appointmentId: appointmentRef.id };
    });
  } catch (error) {
    return errorResult(error);
  }
}
