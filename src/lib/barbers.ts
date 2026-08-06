import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  deleteField,
  runTransaction,
  writeBatch,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { DATA } from './data';
import type { Barber, BarberMetrics, Plan, BillingCycle, BarberStatus, BarberStaff, BusinessCreationErrorCode, BusinessType, BookingSettings, CatalogItem, Product, Service, PublicBusiness, SubscriptionStatus } from './types';
import { bookingSettingsUpdate, getBogotaDateTime, getBookingDate, isValidBookingSettings } from './booking';
import { isPublicBusinessOperational, loadPublicBusinessBySlug, normalizeWorkingHours, PUBLIC_BUSINESSES_COLLECTION, readPublicBusiness, toPublicBusiness } from './public-business';
import { generateStaffEnrollmentCode } from './staff-enrollment';

const LEGACY_BUSINESS_TYPE: BusinessType = 'barbershop';

export class BusinessCreationError extends Error {
  constructor(readonly code: BusinessCreationErrorCode) {
    super(code);
    this.name = 'BusinessCreationError';
  }
}

/** Maps Firestore write failures to safe, actionable UI copy without exposing backend details. */
export function getFirestoreWriteErrorMessage(error: unknown, fallback: string): string {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? (error as { code?: unknown }).code
    : undefined;

  if (code === 'permission-denied') return 'No tienes permisos para guardar este cambio.';
  if (code === 'failed-precondition') return 'Firestore rechazó la operación por una precondición. Actualiza la página e inténtalo de nuevo.';
  if (code === 'unavailable' || code === 'deadline-exceeded') return 'Firestore no está disponible en este momento. Inténtalo de nuevo.';
  return fallback;
}

function toBusinessCreationError(error: unknown): BusinessCreationError {
  if (error instanceof BusinessCreationError) return error;

  const code = typeof error === 'object' && error !== null && 'code' in error
    ? (error as { code?: string }).code
    : undefined;

  if (code === 'permission-denied') return new BusinessCreationError('permission-denied');
  if (code === 'unavailable' || code === 'deadline-exceeded') return new BusinessCreationError('unavailable');
  if (code === 'aborted' || code === 'already-exists' || code === 'failed-precondition') return new BusinessCreationError('conflict');
  return new BusinessCreationError('unknown');
}

function toBusiness(data: Record<string, unknown>, id: string): Barber {
  return { id, businessType: LEGACY_BUSINESS_TYPE, ...data } as Barber;
}

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }

  return new Date(value as string | number | Date);
}

function getSubscriptionEndDate(startsAt: Date, billingCycle: BillingCycle): Date {
  const months = billingCycle === DATA.BILLING_CYCLE.MONTH_3 ? 3 : billingCycle === DATA.BILLING_CYCLE.MONTH_12 ? 12 : 1;
  const nextCycleStart = new Date(startsAt.getFullYear(), startsAt.getMonth() + months, 1);
  const lastDay = new Date(nextCycleStart.getFullYear(), nextCycleStart.getMonth() + 1, 0).getDate();
  nextCycleStart.setDate(Math.min(startsAt.getDate(), lastDay));
  nextCycleStart.setDate(nextCycleStart.getDate() - 1);
  nextCycleStart.setHours(23, 59, 59, 999);
  return nextCycleStart;
}

function isSubscriptionOperational(status: SubscriptionStatus | undefined, planExpiresAt: unknown, subscriptionStartsAt?: unknown, now = new Date()): boolean {
  if (status === undefined) return true;
  if (status !== 'active' && status !== 'trial') return false;

  const startsAt = toDate(subscriptionStartsAt);
  if (subscriptionStartsAt !== undefined && (!Number.isFinite(startsAt.getTime()) || startsAt > now)) return false;

  const expiresAt = toDate(planExpiresAt);
  // Legacy records may not have a usable end date yet. Keep their existing
  // activation contract until a subscription save writes the canonical range.
  return !Number.isFinite(expiresAt.getTime()) || now <= expiresAt;
}

// Cache de configuración de barbería
const BARBER_CACHE_TTL = 60 * 60 * 1000; // 1 hora
const BARBER_CATALOG_CACHE_TTL = 2 * 60 * 60 * 1000; // 2 horas
const BARBER_PRODUCTS_CACHE_TTL = 30 * 60 * 1000; // 30 minutos

export function invalidatePublicBusinessCaches(barberId: string): void {
  localStorage.removeItem(`barber_config_${barberId}`);

  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith('barber_config_slug_')) continue;

    try {
      const cached = localStorage.getItem(key);
      if (cached && JSON.parse(cached)?.data?.id === barberId) localStorage.removeItem(key);
    } catch {
      // A malformed cache entry is unrelated to this save and will be refreshed on its next read.
    }
  }
}

/**
 * Obtener barbería por ID (con cache en localStorage)
 */
export async function getBarberConfig(barberId: string): Promise<PublicBusiness | null> {
  const cacheKey = `barber_config_${barberId}`;
  const cached = localStorage.getItem(cacheKey);

  if (cached) {
    const { data, expiresAt } = JSON.parse(cached);
    if (Date.now() < expiresAt && isPublicBusinessOperational(data)) {
      return data;
    }
  }

  try {
    const barberRef = doc(db, PUBLIC_BUSINESSES_COLLECTION, barberId);
    const barberSnap = await getDoc(barberRef);

    if (!barberSnap.exists()) {
      return null;
    }

    const data = readPublicBusiness(barberSnap.data(), barberSnap.id);
    if (!isPublicBusinessOperational(data)) return null;
    
    // Guardar en cache
    localStorage.setItem(cacheKey, JSON.stringify({
      data,
      expiresAt: Date.now() + BARBER_CACHE_TTL,
    }));

    return data;
  } catch (error) {
    console.error('Error fetching barber config:', error);
    return null;
  }
}

/**
 * Obtener la configuración pública de una barbería por su slug de URL.
 */
export async function getBarberConfigBySlug(slug: string): Promise<PublicBusiness | null> {
  return (await loadPublicBusinessBySlug(slug)).business;
}

/**
 * Obtener todas las barberías (sin cache - para admin)
 */
export async function getAllBarbers(): Promise<Barber[]> {
  try {
    const barbersRef = collection(db, 'barbers');
    const barbersDocs = await getDocs(barbersRef);
    return barbersDocs.docs.map((item) => toBusiness(item.data(), item.id));
  } catch (error) {
    console.error('Error fetching all barbers:', error);
    return [];
  }
}

/** Reads only explicitly allowed public business summaries, never a collection query. */
export async function getBusinessSummaries(businessIds: string[]): Promise<PublicBusiness[]> {
  const ids = [...new Set(businessIds.filter(Boolean))];
  const summaries = await Promise.all(ids.map(async (businessId) => {
    const snapshot = await getDoc(doc(db, PUBLIC_BUSINESSES_COLLECTION, businessId));
    return snapshot.exists() ? readPublicBusiness(snapshot.data(), snapshot.id) : null;
  }));
  return summaries.filter((summary): summary is PublicBusiness => summary !== null);
}

/**
 * Obtener barberías de un propietario específico
 */
export async function getBarbersByOwner(ownerId: string): Promise<Barber[]> {
  try {
    const barbersRef = collection(db, 'barbers');
    const q = query(barbersRef, where('ownerId', '==', ownerId));
    const barbersDocs = await getDocs(q);
    return barbersDocs.docs.map((item) => toBusiness(item.data(), item.id));
  } catch (error) {
    console.error('Error fetching barbers by owner:', error);
    return [];
  }
}

/**
 * Crear nueva barbería
 */
export async function createBarber(
  ownerEmail: string,
  name: string,
  slug: string,
  plan: Plan = DATA.PLAN.STANDARD,
  billingCycle: BillingCycle = DATA.BILLING_CYCLE.MONTH_1,
  businessType: BusinessType = LEGACY_BUSINESS_TYPE,
): Promise<Barber> {
  try {
    const signedInUser = auth.currentUser;
    if (!signedInUser) throw new BusinessCreationError('not-authenticated');

    const normalizedOwnerEmail = ownerEmail.trim().toLowerCase();
    const owners = await getDocs(query(collection(db, 'users'), where('email', '==', normalizedOwnerEmail), limit(1)));
    if (owners.empty) throw new BusinessCreationError('owner-not-found');
    const ownerRef = owners.docs[0].ref;
    if (ownerRef.id === signedInUser.uid) throw new BusinessCreationError('self-owner');
    const ownerId = ownerRef.id;

    const now = new Date();
    const trialEnds = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000);
    const barberData = {
      name, slug, businessType, ownerId, ownerEmail, plan, billingCycle,
      subscriptionStatus: 'trial' as SubscriptionStatus, subscriptionStartsAt: now,
      trialStartedAt: now, trialEndsAt: trialEnds, trialUsed: false,
      planExpiresAt: trialEnds, active: isSubscriptionOperational('trial', trialEnds, now), createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      limits: {
        maxBarbers: getLimitsByPlan(plan).maxBarbers,
        maxProducts: getLimitsByPlan(plan).maxProducts,
        maxGalleryItems: getLimitsByPlan(plan).maxGalleryItems,
      },
      config: { address: '', phone: '', socialLinks: {}, theme: { primaryColor: '#000000' } },
      workingHours: {
        0: { open: '09:00', close: '18:00', enabled: false }, 1: { open: '09:00', close: '18:00', enabled: true },
        2: { open: '09:00', close: '18:00', enabled: true }, 3: { open: '09:00', close: '18:00', enabled: true },
        4: { open: '09:00', close: '18:00', enabled: true }, 5: { open: '09:00', close: '18:00', enabled: true },
        6: { open: '09:00', close: '14:00', enabled: true },
      },
    };
    const docRef = doc(collection(db, 'barbers'));
    const enrollmentCode = generateStaffEnrollmentCode();
    await runTransaction(db, async (transaction) => {
      const ownerSnapshot = await transaction.get(ownerRef);
      if (!ownerSnapshot.exists()) throw new BusinessCreationError('owner-not-found');
      const owner = ownerSnapshot.data();
      if (owner.role !== DATA.USER_ROLE.CUSTOMER) throw new BusinessCreationError('owner-not-customer');
      if (typeof owner.staffId === 'string' ||
        (Array.isArray(owner.businessIds) && owner.businessIds.length > 0)) {
        throw new BusinessCreationError('owner-already-assigned');
      }

      const ownerUpdates = {
        role: DATA.USER_ROLE.STOREADMIN,
        businessIds: [docRef.id],
        updatedAt: serverTimestamp(),
      };
      transaction.set(docRef, barberData);
      transaction.set(doc(db, PUBLIC_BUSINESSES_COLLECTION, docRef.id), toPublicBusiness({ id: docRef.id, ...barberData } as unknown as Barber));
      transaction.set(doc(db, 'staffEnrollmentCodes', enrollmentCode), { businessId: docRef.id, createdAt: serverTimestamp() });
      transaction.set(doc(db, 'barbers', docRef.id, 'staffControl', 'enrollment'), { code: enrollmentCode, rotatedAt: serverTimestamp() });
      transaction.update(ownerRef, ownerUpdates);
    });
    return { id: docRef.id, ...barberData, trialEndsAt: trialEnds as any, planExpiresAt: trialEnds as any } as unknown as Barber;
  } catch (error) {
    console.error('Error creating barber:', error);
    throw toBusinessCreationError(error);
  }
}

/**
 * Actualizar barbería
 */
export async function updateBarber(
  barberId: string,
  updates: Partial<Barber>
): Promise<boolean> {
  try {
    const barberRef = doc(db, 'barbers', barberId);
    await updateDoc(barberRef, {
      ...updates,
      updatedAt: serverTimestamp(),
    });

    // Invalidar cache
    localStorage.removeItem(`barber_config_${barberId}`);
    return true;
  } catch (error) {
    console.error('Error updating barber:', error);
    return false;
  }
}

/** Updates only booking configuration, preserving every other business config field. */
export async function updateBarberBookingSettings(barberId: string, settings: BookingSettings): Promise<void> {
  if (!isValidBookingSettings(settings)) throw new Error('Invalid booking settings.');
  const batch = writeBatch(db);
  batch.update(doc(db, 'barbers', barberId), {
    ...bookingSettingsUpdate(settings),
    updatedAt: serverTimestamp(),
  });
  // Public booking data is served by the server-authorized callable from the
  // canonical root document. Do not duplicate this sensitive policy into the
  // legacy projection, whose stricter public schema rejects closure lists.
  await batch.commit();
  invalidatePublicBusinessCaches(barberId);
}

/** Updates only the existing business-hours field on the root and public projection. */
export async function updateBarberWorkingHours(barberId: string, workingHours: Barber['workingHours']): Promise<void> {
  const normalized = normalizeWorkingHours(workingHours);
  const batch = writeBatch(db);
  batch.update(doc(db, 'barbers', barberId), { workingHours: normalized, updatedAt: serverTimestamp() });
  batch.update(doc(db, PUBLIC_BUSINESSES_COLLECTION, barberId), { workingHours: normalized });
  await batch.commit();
  invalidatePublicBusinessCaches(barberId);
}

/**
 * Updates only operational business fields using dotted paths. This deliberately
 * avoids replacing `config`, which would discard booking settings saved by a
 * concurrent administration session.
 */
export async function updateBarberBusinessDetails(
  barberId: string,
  details: {
    name: string;
    businessType: BusinessType;
    address: string;
    phone: string;
    logoUrl: string;
    coverUrl: string;
    instagram: string;
    facebook: string;
    whatsapp: string;
    primaryColor: string;
    workingHours?: Barber['workingHours'];
  },
): Promise<boolean> {
  try {
    const valueOrDelete = (value: string) => value.trim() || deleteField();
    const updates = {
      name: details.name.trim(),
      businessType: details.businessType,
      'config.address': details.address.trim(),
      'config.phone': details.phone.trim(),
      'config.logoUrl': valueOrDelete(details.logoUrl),
      'config.coverUrl': valueOrDelete(details.coverUrl),
      'config.socialLinks.instagram': valueOrDelete(details.instagram),
      'config.socialLinks.facebook': valueOrDelete(details.facebook),
      'config.socialLinks.whatsapp': valueOrDelete(details.whatsapp),
      'config.theme.primaryColor': details.primaryColor,
      ...(details.workingHours ? { workingHours: details.workingHours } : {}),
      updatedAt: serverTimestamp(),
    };
    const batch = writeBatch(db);
    batch.update(doc(db, 'barbers', barberId), updates);
    const { updatedAt: _updatedAt, ...publicUpdates } = updates;
    batch.update(doc(db, PUBLIC_BUSINESSES_COLLECTION, barberId), publicUpdates);
    await batch.commit();
    invalidatePublicBusinessCaches(barberId);
    return true;
  } catch (error) {
    console.error('Error updating barber business details:', error);
    return false;
  }
}

/**
 * Updates the canonical subscription and its legacy compatibility fields.
 * The public projection receives only the operational `active` mirror and the
 * effective booking cutoff, never subscription metadata.
 */
export async function updateBarberPlanSettings(
  barberId: string,
  newPlan: Plan,
  billingCycle: BillingCycle,
  subscription: { status: SubscriptionStatus; startsAt: Date },
): Promise<boolean> {
  try {
    if (!Number.isFinite(subscription.startsAt.getTime())) {
      return false;
    }

    const barberRef = doc(db, 'barbers', barberId);
    const legacyTrial = subscription.status === 'trial';
    const planExpiresAt = getSubscriptionEndDate(subscription.startsAt, billingCycle);
    const active = isSubscriptionOperational(subscription.status, planExpiresAt, subscription.startsAt);

    const batch = writeBatch(db);
    batch.update(barberRef, {
      plan: newPlan,
      billingCycle,
      limits: getLimitsByPlan(newPlan),
      subscriptionStatus: subscription.status,
      subscriptionStartsAt: subscription.startsAt,
      planExpiresAt,
      active,
      trialUsed: !legacyTrial,
      ...(legacyTrial ? { trialStartedAt: subscription.startsAt, trialEndsAt: planExpiresAt } : {}),
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, PUBLIC_BUSINESSES_COLLECTION, barberId), {
      active,
      ...(active ? { bookingEnabledUntil: planExpiresAt } : { bookingEnabledUntil: deleteField() }),
    });
    await batch.commit();

    localStorage.removeItem(`barber_config_${barberId}`);
    return true;
  } catch (error) {
    console.error('Error updating barber plan settings:', error);
    return false;
  }
}

/**
 * Activar / Desactivar barbería
 */
export async function toggleBarberActive(barberId: string, active: boolean): Promise<boolean> {
  try {
    const barberRef = doc(db, 'barbers', barberId);
    const publicRef = doc(db, PUBLIC_BUSINESSES_COLLECTION, barberId);
    await runTransaction(db, async (transaction) => {
      const barberSnapshot = await transaction.get(barberRef);
      if (!barberSnapshot.exists()) throw new Error('Business not found.');

      const barber = barberSnapshot.data() as Pick<Barber, 'subscriptionStatus' | 'subscriptionStartsAt' | 'planExpiresAt'>;
      const publicActive = active && isSubscriptionOperational(
        barber.subscriptionStatus,
        barber.planExpiresAt,
        barber.subscriptionStartsAt,
      );
      const hasCanonicalCutoff = (barber.subscriptionStatus === 'active' || barber.subscriptionStatus === 'trial') && barber.planExpiresAt !== undefined;
      transaction.update(barberRef, {
        active,
        updatedAt: serverTimestamp(),
      });
      transaction.update(publicRef, {
        active: publicActive,
        ...(publicActive && hasCanonicalCutoff
          ? { bookingEnabledUntil: barber.planExpiresAt }
          : { bookingEnabledUntil: deleteField() }),
      });
    });

    localStorage.removeItem(`barber_config_${barberId}`);
    return true;
  } catch (error) {
    console.error('Error toggling barber active:', error);
    return false;
  }
}

/**
 * Eliminar barbería (borrado lógico, solo para super admin)
 */
export async function deleteBarber(barberId: string): Promise<boolean> {
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'barbers', barberId));
    batch.delete(doc(db, PUBLIC_BUSINESSES_COLLECTION, barberId));
    await batch.commit();
    localStorage.removeItem(`barber_config_${barberId}`);
    return true;
  } catch (error) {
    console.error('Error deleting barber:', error);
    return false;
  }
}

/**
 * Obtiene el estado efectivo para UI (activada / en prueba / desactivada).
 */
export function getBarberStatus(barber: Barber): BarberStatus {
  if (barber.subscriptionStatus === 'disabled') return DATA.BARBER_STATUS.DISABLED;
  if (!barber.active) {
    return DATA.BARBER_STATUS.DISABLED;
  }

  const now = new Date();
  if (!isSubscriptionOperational(barber.subscriptionStatus, barber.planExpiresAt, barber.subscriptionStartsAt, now)) {
    return DATA.BARBER_STATUS.DISABLED;
  }

  if (barber.subscriptionStatus === 'trial') return DATA.BARBER_STATUS.TRIAL;
  if (barber.subscriptionStatus === 'active') return DATA.BARBER_STATUS.ACTIVE;

  const planExpires = toDate(barber.planExpiresAt);

  // Si está en prueba y no ha terminado
  if (!barber.trialUsed && now < planExpires) {
    return DATA.BARBER_STATUS.TRIAL;
  }

  // Si el plan ha expirado
  if (Number.isFinite(planExpires.getTime()) && now > planExpires) {
    return DATA.BARBER_STATUS.DISABLED;
  }

  return DATA.BARBER_STATUS.ACTIVE;
}

/**
 * Obtener límites según el plan
 */
export function getLimitsByPlan(plan: Plan) {
  const limits = {
    [DATA.PLAN.STANDARD]: { maxBarbers: 3, maxProducts: 10, maxGalleryItems: 20 },
    [DATA.PLAN.PLUS]: { maxBarbers: 8, maxProducts: 50, maxGalleryItems: 100 },
    [DATA.PLAN.EXTRA]: { maxBarbers: 20, maxProducts: 200, maxGalleryItems: 500 },
  };
  return limits[plan];
}

/**
 * Obtener métricas básicas de una barbería
 */
export async function getBarberMetrics(barberId: string): Promise<BarberMetrics | null> {
  const cacheKey = `barber_metrics_${barberId}`;
  const cached = localStorage.getItem(cacheKey);

  if (cached) {
    const { data, expiresAt, version } = JSON.parse(cached);
    if (version === 2 && Date.now() < expiresAt) {
      return data;
    }
  }

  try {
    const now = new Date();
    const currentBookingDate = getBookingDate(now);
    const currentMonth = currentBookingDate.slice(0, 7);
    const [year, month] = currentMonth.split('-').map(Number);
    const nextMonth = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
    const legacyMonthStart = getBogotaDateTime(`${currentMonth}-01`, '00:00');
    const legacyNextMonthStart = getBogotaDateTime(`${nextMonth}-01`, '00:00');
    if (!legacyMonthStart || !legacyNextMonthStart) return null;

    const appointmentsRef = collection(db, 'barbers', barberId, 'appointments');
    // New appointments have a Colombia-local bookingDate. The bounded legacy
    // date query remains during migration; IDs are unioned to avoid double-counting
    // records that contain both formats without reading the full collection.
    const [bookingDateAppointments, legacyAppointments] = await Promise.all([
      getDocs(query(
        appointmentsRef,
        where('bookingDate', '>=', `${currentMonth}-01`),
        where('bookingDate', '<', `${nextMonth}-01`),
      )),
      getDocs(query(
        appointmentsRef,
        where('date', '>=', legacyMonthStart),
        where('date', '<', legacyNextMonthStart),
      )),
    ]);
    const appointmentIds = new Set([
      ...bookingDateAppointments.docs.map((appointment) => appointment.id),
      ...legacyAppointments.docs.map((appointment) => appointment.id),
    ]);

    // Contar productos activos
    const productsRef = collection(db, 'barbers', barberId, 'products');
    const productsQuery = query(productsRef, where('active', '==', true));
    const productsDocs = await getDocs(productsQuery);

    // Contar barberos activos
    const barbersRef = collection(db, 'barbers', barberId, 'barbers');
    const barbersQuery = query(barbersRef, where('active', '==', true));
    const barbersDocs = await getDocs(barbersQuery);

    // Contar items del catálogo
    const catalogRef = collection(db, 'barbers', barberId, 'catalog');
    const catalogDocs = await getDocs(catalogRef);

    const metrics: BarberMetrics = {
      barberId,
      appointmentsThisMonth: appointmentIds.size,
      activeProducts: productsDocs.size,
      activeBarbers: barbersDocs.size,
      totalCatalogItems: catalogDocs.size,
    };

    // Cache 1 hora
    localStorage.setItem(cacheKey, JSON.stringify({
      version: 2,
      data: metrics,
      expiresAt: Date.now() + 60 * 60 * 1000,
    }));

    return metrics;
  } catch (error) {
    console.error('Error fetching barber metrics:', error);
    return null;
  }
}

/**
 * Obtener catálogo público de una barbería (con cache en localStorage)
 */
export async function getBarberCatalog(barberId: string): Promise<CatalogItem[]> {
  const cacheKey = `barber_catalog_${barberId}`;
  const cached = localStorage.getItem(cacheKey);

  if (cached) {
    const { data, expiresAt } = JSON.parse(cached);
    if (Date.now() < expiresAt) {
      return data as CatalogItem[];
    }
  }

  try {
    const catalogRef = collection(db, 'barbers', barberId, 'catalog');
    const catalogDocs = await getDocs(catalogRef);
    const items = catalogDocs.docs.map((catalogDoc) => ({ id: catalogDoc.id, ...catalogDoc.data() } as CatalogItem));

    localStorage.setItem(
      cacheKey,
      JSON.stringify({
        data: items,
        expiresAt: Date.now() + BARBER_CATALOG_CACHE_TTL,
      })
    );

    return items;
  } catch (error) {
    console.error('Error fetching barber catalog:', error);
    throw error;
  }
}

/**
 * Obtener productos activos de una barbería (con cache en localStorage)
 */
export async function getBarberProducts(barberId: string): Promise<Product[]> {
  const cacheKey = `barber_products_${barberId}`;
  const cached = localStorage.getItem(cacheKey);

  if (cached) {
    const { data, expiresAt } = JSON.parse(cached);
    if (Date.now() < expiresAt) {
      return data as Product[];
    }
  }

  try {
    const productsRef = collection(db, 'barbers', barberId, 'products');
    const productsQuery = query(productsRef, where('active', '==', true));
    const productsDocs = await getDocs(productsQuery);
    const products = productsDocs.docs.map((productDoc) => ({ id: productDoc.id, ...productDoc.data() } as Product));

    localStorage.setItem(
      cacheKey,
      JSON.stringify({
        data: products,
        expiresAt: Date.now() + BARBER_PRODUCTS_CACHE_TTL,
      })
    );

    return products;
  } catch (error) {
    console.error('Error fetching barber products:', error);
    throw error;
  }
}

type ManagedCollection = 'catalog' | 'products' | 'services' | 'barbers';
type ManagedRecord = CatalogItem | Product | Service | BarberStaff;

function clearCollectionCache(barberId: string, collectionName: ManagedCollection) {
  const cacheKeys: Record<ManagedCollection, string> = {
    catalog: `barber_catalog_${barberId}`,
    products: `barber_products_${barberId}`,
    services: `barber_services_${barberId}`,
    barbers: `barber_staff_${barberId}`,
  };
  localStorage.removeItem(cacheKeys[collectionName]);
  localStorage.removeItem(`barber_metrics_${barberId}`);
}

/** Datos completos para administración, incluidos registros inactivos. */
export async function getBarberManagedCollection<T extends ManagedRecord>(
  barberId: string,
  collectionName: ManagedCollection,
): Promise<T[]> {
  try {
    const snapshot = await getDocs(collection(db, 'barbers', barberId, collectionName));
    return snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as T));
  } catch (error) {
    console.error(`Error fetching ${collectionName}:`, error);
    return [];
  }
}

export async function createBarberManagedRecord(
  barberId: string,
  collectionName: ManagedCollection,
  data: Omit<Record<string, unknown>, 'id'>,
): Promise<boolean> {
  try {
    await addDoc(collection(db, 'barbers', barberId, collectionName), {
      ...data,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    clearCollectionCache(barberId, collectionName);
    return true;
  } catch (error) {
    console.error(`Error creating ${collectionName} record:`, error);
    return false;
  }
}

export async function updateBarberManagedRecord(
  barberId: string,
  collectionName: ManagedCollection,
  recordId: string,
  data: Record<string, unknown>,
): Promise<void> {
  await updateDoc(doc(db, 'barbers', barberId, collectionName, recordId), {
    ...data,
    updatedAt: serverTimestamp(),
  });
  clearCollectionCache(barberId, collectionName);
}

export async function deleteBarberManagedRecord(
  barberId: string,
  collectionName: ManagedCollection,
  recordId: string,
): Promise<boolean> {
  try {
    await deleteDoc(doc(db, 'barbers', barberId, collectionName, recordId));
    clearCollectionCache(barberId, collectionName);
    return true;
  } catch (error) {
    console.error(`Error deleting ${collectionName} record:`, error);
    return false;
  }
}
