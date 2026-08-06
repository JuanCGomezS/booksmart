import {
  collection,
  deleteField,
  doc,
  runTransaction,
  serverTimestamp,
  type DocumentReference,
  type Firestore,
  type Transaction,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  BOOKING_PRIVACY_CONSENT_VERSION,
  appointmentStatusBlocksAgenda,
  bookingRequestsAdditionalCustomerData,
  checkBookingAvailability,
  getBookingLockIntervals,
  isServiceCompatibleWithStaff,
  normalizeBookingCustomerFields,
  timeToMinutes,
} from './booking';
import { PUBLIC_BUSINESSES_COLLECTION } from './public-business';
import { app, auth } from './firebase';
import type { AppointmentProductRequest, BarberStaff, BookingSettings, PublicBusiness, Service } from './types';

export const BOOKING_CONFLICT_MESSAGE = 'Ese horario acaba de ser ocupado. Por favor, elige otra hora.';
export const BOOKING_UNAVAILABLE_MESSAGE = 'Ese horario ya no está disponible. Por favor, elige otra hora.';
export const BOOKING_PERMISSION_MESSAGE = 'No tenemos permiso para confirmar la solicitud. Inténtalo nuevamente.';
export const BOOKING_NETWORK_MESSAGE = 'No pudimos conectar para confirmar la solicitud. Revisa tu conexión e inténtalo nuevamente.';
export const BOOKING_PRECONDITION_MESSAGE = 'La solicitud cambió antes de confirmarse. Actualiza la página e inténtalo nuevamente.';
export const BOOKING_PHONE_DAY_MESSAGE = 'Ya tienes una solicitud de agendamiento para este negocio en esa fecha.';
export const BOOKING_ERROR_MESSAGE = 'No pudimos confirmar la solicitud. Inténtalo nuevamente.';
export const BOOKING_NOTE_MAX_LENGTH = 500;

export interface PublicBookingConfiguration {
  business: Pick<PublicBusiness, 'active' | 'workingHours'> & { config: { booking?: BookingSettings } };
  service: Pick<Service, 'id' | 'active' | 'duration' | 'bufferMinutes' | 'staffIds'>;
  staff: Pick<BarberStaff, 'id' | 'active' | 'schedule'>;
  /** Every compatible staff member loaded for a normal "any professional" booking. */
  compatibleStaff?: Array<Pick<BarberStaff, 'id' | 'active' | 'schedule'>>;
}

export interface ClientBookingRequest {
  businessId: string;
  serviceId: string;
  bookingDate: string;
  startTime: string;
  clientName: string;
  clientPhone: string;
  clientEmail?: string;
  clientAddress?: string;
  /** The public widget can submit this only when the business asks for extra data. */
  acceptedBookingPrivacy?: boolean;
  /** When true, reserve compatible capacity without disclosing or assigning its professional. */
  anyProfessional?: boolean;
  /** Required for a named professional; never persisted for unassigned capacity. */
  staffId?: string;
  /** Informational product interest captured from the active public catalog. */
  requestedProducts?: AppointmentProductRequest[];
  /** Optional private booking note for the business staff. */
  notes?: string;
  /** Stable per submit action so a network retry returns the original booking. */
  idempotencyKey: string;
}

export type ClientBookingResult =
  | { ok: true; appointmentId: string }
  | { ok: false; code: 'conflict' | 'duplicate_phone_day' | 'unavailable' | 'permission_denied' | 'network' | 'failed_precondition' | 'error'; message: string };

/** Removes control characters while retaining intentional line breaks in a private booking note. */
export function normalizeBookingNote(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
  return normalized || undefined;
}

type ClientBookingFailure = Extract<ClientBookingResult, { ok: false }>;

export interface BookingSnapshot<T> {
  exists(): boolean;
  data(): T | undefined;
}

export interface BookingTransactionAdapter<Reference> {
  run<T>(update: (transaction: {
    get<T>(reference: Reference): Promise<BookingSnapshot<T>>;
    set(reference: Reference, value: Record<string, unknown>): void;
    update(reference: Reference, value: Record<string, unknown>): void;
    delete(reference: Reference): void;
  }) => Promise<T>): Promise<T>;
}

export interface BookingReferenceFactory<Reference> {
  business(businessId: string): Reference;
  service(businessId: string, serviceId: string): Reference;
  staff(businessId: string, staffId: string): Reference;
  appointment(businessId: string): Reference & { id: string };
  lock(businessId: string, bookingDate: string, staffId: string, intervalId: string): Reference;
}

export interface ClaimableAppointment {
  id: string;
  assignmentState?: 'assigned' | 'unassigned';
  capacityStaffId?: string;
  serviceId: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  occupiedIntervalIds: string[];
  status: 'pending' | 'confirmed' | 'cancelled' | 'done' | 'no_show';
}

/** Agenda records already loaded for the claiming professional, including legacy appointments. */
export interface LoadedAgendaOccupancy {
  id: string;
  barberId?: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  status: string;
}

export type ClaimAppointmentResult =
  | { ok: true }
  | { ok: false; code: 'conflict' | 'unavailable' | 'permission_denied' | 'network' | 'failed_precondition' | 'error'; message: string };

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

function validClientDetails(request: ClientBookingRequest, customerFields: ReturnType<typeof normalizeBookingCustomerFields>): boolean {
  const name = request.clientName.trim();
  const phone = request.clientPhone.trim();
  const email = request.clientEmail?.trim() || '';
  const address = request.clientAddress?.trim() || '';
  const emailRequested = customerFields.email !== 'disabled';
  const addressRequested = customerFields.address !== 'disabled';
  const emailValid = !email || (email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
  return name.length >= 1 && name.length <= 120 && phone.length >= 1 && phone.length <= 40 &&
    (!emailRequested ? !email : emailValid && (customerFields.email !== 'required' || email.length > 0)) &&
    (!addressRequested ? !address : address.length <= 240 && (customerFields.address !== 'required' || address.length > 0)) &&
    (!bookingRequestsAdditionalCustomerData(customerFields) || request.acceptedBookingPrivacy === true);
}

function validRequestedProducts(products: AppointmentProductRequest[] | undefined): boolean {
  return !products || new Set(products.map((product) => product.productId)).size === products.length && products.every((product) =>
    typeof product.productId === 'string' && product.productId.length > 0 && product.productId.length <= 150 &&
    typeof product.name === 'string' && product.name.trim().length > 0 && product.name.trim().length <= 120 &&
    Number.isInteger(product.quantity) && product.quantity >= 1 && product.quantity <= 10,
  );
}

function validBookingNote(note: string | undefined): boolean {
  return note === undefined || (typeof note === 'string' && note.length <= BOOKING_NOTE_MAX_LENGTH);
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

function errorResult(error: unknown): ClientBookingFailure {
  if (error instanceof BookingConflictError || ['aborted', 'already-exists', 'conflict'].includes(firestoreErrorCode(error) || '')) {
    if (firestoreErrorCode(error) === 'already-exists') return { ok: false, code: 'duplicate_phone_day', message: BOOKING_PHONE_DAY_MESSAGE };
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
 * Revalidates the public business, selected service, and every normal-client
 * capacity candidate inside the transaction before writing the appointment and locks.
 */
export async function createClientBooking<Reference = DocumentReference>(
  request: ClientBookingRequest,
  _loadedConfiguration: PublicBookingConfiguration,
  options: { firestore?: Firestore; now?: Date; adapters?: BookingAdapters<Reference> } = {},
): Promise<ClientBookingResult> {
  // Public appointment writes go through the callable boundary. The direct
  // transaction path remains injectable only for local adapters and focused
  // tests; Firestore Rules reject anonymous appointment and lock writes.
  if (!options.adapters && !options.firestore) {
    try {
      const submit = httpsCallable<ClientBookingRequest, { appointmentId: string }>(getFunctions(app), 'createPublicBooking');
      const result = await submit(request);
      return { ok: true, appointmentId: result.data.appointmentId };
    } catch (error) {
      return errorResult(error);
    }
  }
  const adapters = options.adapters || firebaseAdapters(
    options.firestore || (await import('./firebase')).db,
  ) as unknown as BookingAdapters<Reference>;
  const { references } = adapters;
  const appointmentRef = references.appointment(request.businessId);

  try {
    return await adapters.transaction.run(async (transaction) => {
      const [businessSnapshot, serviceSnapshot] = await Promise.all([
        transaction.get<PublicBookingConfiguration['business']>(references.business(request.businessId)),
        transaction.get<PublicBookingConfiguration['service']>(references.service(request.businessId, request.serviceId)),
      ]);
      if (!businessSnapshot.exists() || !serviceSnapshot.exists()) {
        return { ok: false, code: 'unavailable', message: BOOKING_UNAVAILABLE_MESSAGE };
      }

      const business = businessSnapshot.data();
      const service = serviceSnapshot.data();
      if (!business || !service) return { ok: false, code: 'unavailable', message: BOOKING_UNAVAILABLE_MESSAGE };

      const settings = business.config.booking;
      const customerFields = normalizeBookingCustomerFields(settings?.customerFields);
      const productSelectionEnabled = settings?.productSelectionEnabled === true;
      if (!validClientDetails(request, customerFields) || !validRequestedProducts(request.requestedProducts) || !validBookingNote(request.notes) || (!productSelectionEnabled && request.requestedProducts?.length)) {
        return { ok: false, code: 'unavailable', message: BOOKING_UNAVAILABLE_MESSAGE };
      }
      const intervals = getBookingLockIntervals(
        request.startTime,
        service.duration,
        service.bufferMinutes || 0,
        settings?.slotIntervalMinutes || 30,
      );
      if (!intervals?.length) return { ok: false, code: 'unavailable', message: BOOKING_UNAVAILABLE_MESSAGE };

      const candidateIds = [...new Set((request.anyProfessional
        ? _loadedConfiguration.compatibleStaff?.map((member) => member.id)
        : [_loadedConfiguration.staff.id]) || [])];
      if (!candidateIds.length) return { ok: false, code: 'unavailable', message: BOOKING_UNAVAILABLE_MESSAGE };

      // Read every normal-client candidate and all of its locks inside this
      // transaction. Retried concurrent transactions can therefore select a
      // different compatible professional instead of contending on one stale
      // client-side choice.
      const staffSnapshots = await Promise.all(candidateIds.map((staffId) =>
        transaction.get<PublicBookingConfiguration['staff']>(references.staff(request.businessId, staffId)),
      ));
      const candidates = staffSnapshots.flatMap((snapshot, index) => {
        const staff = snapshot.data();
        return snapshot.exists() && staff ? [{ staffId: candidateIds[index], staff }] : [];
      });
      const candidateLocks = await Promise.all(candidates.map(async ({ staffId }) => {
        const refs = intervals.map((interval) => references.lock(request.businessId, request.bookingDate, staffId, interval.id));
        return { staffId, refs, snapshots: await Promise.all(refs.map((reference) => transaction.get(reference))) };
      }));
      const selected = candidates.find(({ staffId, staff }) => {
        const availability = checkBookingAvailability({ business, service, staff, staffId, bookingDate: request.bookingDate, startTime: request.startTime, now: options.now });
        return availability.available && candidateLocks.find((locks) => locks.staffId === staffId)?.snapshots.every((snapshot) => !snapshot.exists());
      });
      if (!selected) throw new BookingConflictError();

      const availability = checkBookingAvailability({ business, service, staff: selected.staff, staffId: selected.staffId, bookingDate: request.bookingDate, startTime: request.startTime, now: options.now });
      if (!availability.available) return { ok: false, code: 'unavailable', message: BOOKING_UNAVAILABLE_MESSAGE };
      const lockRefs = candidateLocks.find((locks) => locks.staffId === selected.staffId)!.refs;

      transaction.set(appointmentRef, {
        clientName: request.clientName.trim(), clientPhone: request.clientPhone.trim(),
        ...(customerFields.email !== 'disabled' && request.clientEmail?.trim() ? { clientEmail: request.clientEmail.trim() } : {}),
        ...(customerFields.address !== 'disabled' && request.clientAddress?.trim() ? { clientAddress: request.clientAddress.trim() } : {}),
        ...(bookingRequestsAdditionalCustomerData(customerFields) ? {
          bookingPrivacyConsent: { version: BOOKING_PRIVACY_CONSENT_VERSION, acceptedAt: serverTimestamp() },
        } : {}),
        ...(request.anyProfessional
          ? { assignmentState: 'unassigned', capacityStaffId: selected.staffId }
          : { barberId: selected.staffId }),
        serviceId: request.serviceId, extraServices: [], bookingDate: request.bookingDate,
        ...(productSelectionEnabled && request.requestedProducts?.length ? {
          requestedProducts: request.requestedProducts.map((product) => ({
            productId: product.productId,
            name: product.name.trim(),
            quantity: product.quantity,
          })),
        } : {}),
        startTime: request.startTime, endTime: availability.endTime, occupiedIntervalIds: intervals.map((interval) => interval.id),
        primaryLockId: intervals[0].id, status: 'pending',
        ...(normalizeBookingNote(request.notes) ? { notes: normalizeBookingNote(request.notes) } : {}),
        ...(auth.currentUser ? { customerUid: auth.currentUser.uid } : {}),
        createdAt: serverTimestamp(),
      });
      lockRefs.forEach((lockRef, index) => {
        const interval = intervals[index];
        transaction.set(lockRef, {
          appointmentId: appointmentRef.id, bookingDate: request.bookingDate, staffId: selected.staffId,
          intervalId: interval.id, startTime: interval.startTime, endTime: interval.endTime, createdAt: serverTimestamp(),
        });
      });
      return { ok: true, appointmentId: appointmentRef.id };
    });
  } catch (error) {
    return errorResult(error);
  }
}

/**
 * Atomically assigns an unassigned appointment to the signed-in professional
 * and moves its deterministic capacity locks to that professional's namespace.
 */
export async function claimUnassignedAppointment(
  businessId: string,
  appointment: Pick<ClaimableAppointment, 'id'>,
  staffId: string,
  options: { firestore?: Firestore; now?: Date; loadedAgenda?: readonly LoadedAgendaOccupancy[] } = {},
): Promise<ClaimAppointmentResult> {
  const firestore = options.firestore || (await import('./firebase')).db;
  const appointmentRef = doc(firestore, 'barbers', businessId, 'appointments', appointment.id);

  try {
    return await runTransaction(firestore, async (transaction) => {
      const currentAppointment = await transaction.get(appointmentRef);
      if (!currentAppointment.exists()) return { ok: false, code: 'unavailable', message: BOOKING_UNAVAILABLE_MESSAGE };
      const current = { id: currentAppointment.id, ...currentAppointment.data() } as ClaimableAppointment;
      if (current.assignmentState !== 'unassigned' || !current.capacityStaffId || !['pending', 'confirmed'].includes(current.status)) {
        return { ok: false, code: 'unavailable', message: 'Esta solicitud ya fue asignada o no está disponible.' };
      }

      const [businessSnapshot, serviceSnapshot, staffSnapshot] = await Promise.all([
        transaction.get(doc(firestore, PUBLIC_BUSINESSES_COLLECTION, businessId)),
        transaction.get(doc(firestore, 'barbers', businessId, 'services', current.serviceId)),
        transaction.get(doc(firestore, 'barbers', businessId, 'barbers', staffId)),
      ]);
      if (!businessSnapshot.exists() || !serviceSnapshot.exists() || !staffSnapshot.exists()) {
        return { ok: false, code: 'unavailable', message: BOOKING_UNAVAILABLE_MESSAGE };
      }
      const business = businessSnapshot.data() as PublicBookingConfiguration['business'];
      const service = serviceSnapshot.data() as PublicBookingConfiguration['service'];
      const staff = staffSnapshot.data() as PublicBookingConfiguration['staff'];
      if (!isServiceCompatibleWithStaff(service as Service, staffId)) return { ok: false, code: 'unavailable', message: 'No puedes asumir esta solicitud.' };
      const availability = checkBookingAvailability({ business, service, staff, staffId, bookingDate: current.bookingDate, startTime: current.startTime, now: options.now });
      if (!availability.available) return { ok: false, code: 'unavailable', message: 'Tu agenda ya no tiene disponibilidad para esta solicitud.' };

      const appointmentStart = timeToMinutes(current.startTime);
      const appointmentEnd = timeToMinutes(current.endTime);
      const overlapsLoadedOccupancy = options.loadedAgenda?.some((item) => {
        if (item.id === current.id || item.barberId !== staffId || item.bookingDate !== current.bookingDate || !appointmentStatusBlocksAgenda(item.status)) return false;
        const occupiedStart = timeToMinutes(item.startTime);
        const occupiedEnd = timeToMinutes(item.endTime);
        return appointmentStart !== null && appointmentEnd !== null && occupiedStart !== null && occupiedEnd !== null &&
          appointmentStart < occupiedEnd && appointmentEnd > occupiedStart;
      });
      if (overlapsLoadedOccupancy) {
        return { ok: false, code: 'unavailable', message: 'Tu agenda ya tiene una solicitud en ese horario.' };
      }

      const intervalIds = Array.isArray(current.occupiedIntervalIds) ? current.occupiedIntervalIds : [];
      if (!intervalIds.length) return { ok: false, code: 'unavailable', message: BOOKING_UNAVAILABLE_MESSAGE };
      const capacityLockRefs = intervalIds.map((intervalId) => doc(firestore, 'barbers', businessId, 'bookingLocks', current.bookingDate, 'staff', current.capacityStaffId!, 'intervals', intervalId));
      const staffLockRefs = intervalIds.map((intervalId) => doc(firestore, 'barbers', businessId, 'bookingLocks', current.bookingDate, 'staff', staffId, 'intervals', intervalId));
      const capacityLocks = await Promise.all(capacityLockRefs.map((reference) => transaction.get(reference)));
      if (capacityLocks.some((lock) => !lock.exists() || lock.data()?.appointmentId !== current.id)) {
        throw new BookingConflictError();
      }

      // The capacity professional already owns these locks. Retaining them is
      // the only valid atomic claim for this case; deleting then recreating the
      // same documents would reject the claim and briefly weaken occupancy.
      if (current.capacityStaffId === staffId) {
        transaction.update(appointmentRef, { assignmentState: 'assigned', barberId: staffId, capacityStaffId: deleteField(), updatedAt: serverTimestamp() });
        return { ok: true };
      }

      const staffLocks = await Promise.all(staffLockRefs.map((reference) => transaction.get(reference)));
      if (staffLocks.some((lock) => lock.exists())) throw new BookingConflictError();
      transaction.update(appointmentRef, { assignmentState: 'assigned', barberId: staffId, capacityStaffId: deleteField(), updatedAt: serverTimestamp() });
      capacityLockRefs.forEach((reference) => transaction.delete(reference));
      staffLockRefs.forEach((reference, index) => {
        const previous = capacityLocks[index].data()!;
        transaction.set(reference, { ...previous, staffId, createdAt: serverTimestamp() });
      });
      return { ok: true };
    });
  } catch (error) {
    const result = errorResult(error);
    return result.code === 'duplicate_phone_day'
      ? { ok: false, code: 'conflict', message: BOOKING_CONFLICT_MESSAGE }
      : { ok: false, code: result.code as Exclude<typeof result.code, 'duplicate_phone_day'>, message: result.message };
  }
}
