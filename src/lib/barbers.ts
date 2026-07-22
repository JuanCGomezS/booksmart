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
} from 'firebase/firestore';
import { db } from './firebase';
import { DATA } from './data';
import { getUserIdByEmail } from './users';
import type { Barber, BarberMetrics, Plan, BillingCycle, BarberStatus, BarberStaff, BusinessType, BookingSettings, CatalogItem, Product, Service } from './types';
import { bookingSettingsUpdate } from './booking';

const LEGACY_BUSINESS_TYPE: BusinessType = 'barbershop';

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

// Cache de configuración de barbería
const BARBER_CACHE_TTL = 60 * 60 * 1000; // 1 hora
const BARBER_CATALOG_CACHE_TTL = 2 * 60 * 60 * 1000; // 2 horas
const BARBER_PRODUCTS_CACHE_TTL = 30 * 60 * 1000; // 30 minutos

/**
 * Obtener barbería por ID (con cache en localStorage)
 */
export async function getBarberConfig(barberId: string): Promise<Barber | null> {
  const cacheKey = `barber_config_${barberId}`;
  const cached = localStorage.getItem(cacheKey);

  if (cached) {
    const { data, expiresAt } = JSON.parse(cached);
    if (Date.now() < expiresAt) {
      return data;
    }
  }

  try {
    const barberRef = doc(db, 'barbers', barberId);
    const barberSnap = await getDoc(barberRef);

    if (!barberSnap.exists()) {
      return null;
    }

    const data = toBusiness(barberSnap.data(), barberSnap.id);
    
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
export async function getBarberConfigBySlug(slug: string): Promise<Barber | null> {
  const cacheKey = `barber_config_slug_${slug}`;
  const cached = localStorage.getItem(cacheKey);

  if (cached) {
    const { data, expiresAt } = JSON.parse(cached);
    if (Date.now() < expiresAt) {
      return data;
    }
  }

  try {
    const barbersRef = collection(db, 'barbers');
    const barberQuery = query(barbersRef, where('slug', '==', slug), where('active', '==', true), limit(1));
    const barberDocs = await getDocs(barberQuery);

    if (barberDocs.empty) {
      return null;
    }

    const barberDoc = barberDocs.docs[0];
    const data = toBusiness(barberDoc.data(), barberDoc.id);

    localStorage.setItem(cacheKey, JSON.stringify({
      data,
      expiresAt: Date.now() + BARBER_CACHE_TTL,
    }));

    return data;
  } catch (error) {
    console.error('Error fetching barber config by slug:', error);
    return null;
  }
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
): Promise<Barber | null> {
  try {
    // Convertir email a UID
    const ownerId = await getUserIdByEmail(ownerEmail);
    if (!ownerId) {
      throw new Error(`Usuario no encontrado: ${ownerEmail}`);
    }

    // Generar fechas
    const now = new Date();
    const trialEnds = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000); // 15 días

    const barberData = {
      name,
      slug,
      businessType,
      ownerId,
      ownerEmail,
      plan,
      billingCycle,
      trialStartedAt: serverTimestamp(),
      trialEndsAt: trialEnds,
      trialUsed: false,
      planExpiresAt: trialEnds,
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      limits: {
        maxBarbers: getLimitsByPlan(plan).maxBarbers,
        maxProducts: getLimitsByPlan(plan).maxProducts,
        maxGalleryItems: getLimitsByPlan(plan).maxGalleryItems,
      },
      config: {
        address: '',
        phone: '',
        socialLinks: {},
        theme: { primaryColor: '#000000' },
      },
      workingHours: {
        0: { open: '09:00', close: '18:00', enabled: false }, // Sunday
        1: { open: '09:00', close: '18:00', enabled: true },  // Monday
        2: { open: '09:00', close: '18:00', enabled: true },  // Tuesday
        3: { open: '09:00', close: '18:00', enabled: true },  // Wednesday
        4: { open: '09:00', close: '18:00', enabled: true },  // Thursday
        5: { open: '09:00', close: '18:00', enabled: true },  // Friday
        6: { open: '09:00', close: '14:00', enabled: true },  // Saturday
      },
    };

    const barbersRef = collection(db, 'barbers');
    const docRef = await addDoc(barbersRef, barberData);

    return {
      id: docRef.id,
      ...barberData,
      trialEndsAt: trialEnds as any,
      planExpiresAt: trialEnds as any,
    } as unknown as Barber;
  } catch (error) {
    console.error('Error creating barber:', error);
    return null;
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
export async function updateBarberBookingSettings(barberId: string, settings: BookingSettings): Promise<boolean> {
  try {
    await updateDoc(doc(db, 'barbers', barberId), {
      ...bookingSettingsUpdate(settings),
      updatedAt: serverTimestamp(),
    });
    localStorage.removeItem(`barber_config_${barberId}`);
    return true;
  } catch (error) {
    console.error('Error updating barber booking settings:', error);
    return false;
  }
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
    workingHours: Barber['workingHours'];
  },
): Promise<boolean> {
  try {
    const valueOrDelete = (value: string) => value.trim() || deleteField();
    await updateDoc(doc(db, 'barbers', barberId), {
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
      workingHours: details.workingHours,
      updatedAt: serverTimestamp(),
    });
    localStorage.removeItem(`barber_config_${barberId}`);
    return true;
  } catch (error) {
    console.error('Error updating barber business details:', error);
    return false;
  }
}

/**
 * Actualizar plan de una barbería
 */
export async function updateBarberPlan(
  barberId: string,
  newPlan: Plan,
  billingCycle: BillingCycle
): Promise<boolean> {
  return updateBarberPlanSettings(barberId, newPlan, billingCycle);
}

/**
 * Actualizar plan y fecha de expiración de una barbería
 */
export async function updateBarberPlanSettings(
  barberId: string,
  newPlan: Plan,
  billingCycle: BillingCycle,
  planExpiresAtInput?: Date
): Promise<boolean> {
  try {
    const barberRef = doc(db, 'barbers', barberId);

    // Calcular nueva fecha de expiración según el ciclo (o respetar la definida manualmente)
    const planExpiresAt = planExpiresAtInput ? new Date(planExpiresAtInput) : new Date();

    if (!planExpiresAtInput) {
      if (billingCycle === DATA.BILLING_CYCLE.MONTH_1) {
        planExpiresAt.setMonth(planExpiresAt.getMonth() + 1);
      } else if (billingCycle === DATA.BILLING_CYCLE.MONTH_3) {
        planExpiresAt.setMonth(planExpiresAt.getMonth() + 3);
      } else if (billingCycle === DATA.BILLING_CYCLE.MONTH_12) {
        planExpiresAt.setFullYear(planExpiresAt.getFullYear() + 1);
      }
    }

    await updateDoc(barberRef, {
      plan: newPlan,
      billingCycle,
      planExpiresAt,
      active: true,
      trialUsed: true,
      updatedAt: serverTimestamp(),
    });

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
    await updateDoc(barberRef, {
      active,
      updatedAt: serverTimestamp(),
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
    const barberRef = doc(db, 'barbers', barberId);
    await deleteDoc(barberRef);
    localStorage.removeItem(`barber_config_${barberId}`);
    return true;
  } catch (error) {
    console.error('Error deleting barber:', error);
    return false;
  }
}

/**
 * Obtener estado de una barbería (activa / trial / expirada)
 */
export function getBarberStatus(barber: Barber): BarberStatus {
  const now = new Date();
  const planExpires = toDate(barber.planExpiresAt);

  if (!barber.active) {
    return DATA.BARBER_STATUS.EXPIRED;
  }

  // Si está en prueba y no ha terminado
  if (!barber.trialUsed && now < planExpires) {
    return DATA.BARBER_STATUS.TRIAL;
  }

  // Si el plan ha expirado
  if (now > planExpires) {
    return DATA.BARBER_STATUS.EXPIRED;
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
    const { data, expiresAt } = JSON.parse(cached);
    if (Date.now() < expiresAt) {
      return data;
    }
  }

  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Contar citas del mes
    const appointmentsRef = collection(db, 'barbers', barberId, 'appointments');
    const appointmentsQuery = query(
      appointmentsRef,
      where('date', '>=', monthStart)
    );
    const appointmentsDocs = await getDocs(appointmentsQuery);

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
      appointmentsThisMonth: appointmentsDocs.size,
      activeProducts: productsDocs.size,
      activeBarbers: barbersDocs.size,
      totalCatalogItems: catalogDocs.size,
    };

    // Cache 1 hora
    localStorage.setItem(cacheKey, JSON.stringify({
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
    return [];
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
    return [];
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
): Promise<boolean> {
  try {
    await updateDoc(doc(db, 'barbers', barberId, collectionName, recordId), {
      ...data,
      updatedAt: serverTimestamp(),
    });
    clearCollectionCache(barberId, collectionName);
    return true;
  } catch (error) {
    console.error(`Error updating ${collectionName} record:`, error);
    return false;
  }
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
