// CRUD de barberías para el super admin

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import type { Barber, BarberMetrics, Plan, BillingCycle } from './types';

// Cache de configuración de barbería
const BARBER_CACHE_TTL = 60 * 60 * 1000; // 1 hora

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

    const data = { id: barberSnap.id, ...barberSnap.data() } as Barber;
    
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
 * Obtener todas las barberías (sin cache - para admin)
 */
export async function getAllBarbers(): Promise<Barber[]> {
  try {
    const barbersRef = collection(db, 'barbers');
    const barbersDocs = await getDocs(barbersRef);
    return barbersDocs.docs.map(doc => ({ id: doc.id, ...doc.data() } as Barber));
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
    return barbersDocs.docs.map(doc => ({ id: doc.id, ...doc.data() } as Barber));
  } catch (error) {
    console.error('Error fetching barbers by owner:', error);
    return [];
  }
}

/**
 * Crear nueva barbería
 */
export async function createBarber(
  ownerId: string,
  name: string,
  slug: string,
  plan: Plan = 'standard',
  billingCycle: BillingCycle = 'month_1'
): Promise<Barber | null> {
  try {
    // Generar fechas
    const now = new Date();
    const trialEnds = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000); // 15 días

    const barberData = {
      name,
      slug,
      ownerId,
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
    } as Barber;
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

/**
 * Actualizar plan de una barbería
 */
export async function updateBarberPlan(
  barberId: string,
  newPlan: Plan,
  billingCycle: BillingCycle
): Promise<boolean> {
  try {
    const barberRef = doc(db, 'barbers', barberId);

    // Calcular nueva fecha de expiración según el ciclo
    const now = new Date();
    let planExpiresAt = now;

    if (billingCycle === 'month_1') {
      planExpiresAt.setMonth(planExpiresAt.getMonth() + 1);
    } else if (billingCycle === 'month_3') {
      planExpiresAt.setMonth(planExpiresAt.getMonth() + 3);
    } else if (billingCycle === 'month_12') {
      planExpiresAt.setFullYear(planExpiresAt.getFullYear() + 1);
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
    console.error('Error updating barber plan:', error);
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
export function getBarberStatus(barber: Barber): 'active' | 'trial' | 'expired' {
  const now = new Date();
  const planExpires = barber.planExpiresAt instanceof Date 
    ? barber.planExpiresAt 
    : (barber.planExpiresAt as any).toDate?.() || new Date(barber.planExpiresAt);

  if (!barber.active) {
    return 'expired';
  }

  // Si está en prueba y no ha terminado
  if (!barber.trialUsed && now < planExpires) {
    return 'trial';
  }

  // Si el plan ha expirado
  if (now > planExpires) {
    return 'expired';
  }

  return 'active';
}

/**
 * Obtener límites según el plan
 */
export function getLimitsByPlan(plan: Plan) {
  const limits = {
    standard: { maxBarbers: 3, maxProducts: 10, maxGalleryItems: 20 },
    plus: { maxBarbers: 8, maxProducts: 50, maxGalleryItems: 100 },
    extra: { maxBarbers: 20, maxProducts: 200, maxGalleryItems: 500 },
  };
  return limits[plan];
}

/**
 * Obtener métricas básicas de una barbería
 */
export async function getBarberMetrics(barberId: string): Promise<BarberMetrics | null> {
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

    return {
      barberId,
      appointmentsThisMonth: appointmentsDocs.size,
      activeProducts: productsDocs.size,
      activeBarbers: barbersDocs.size,
      totalCatalogItems: catalogDocs.size,
    };
  } catch (error) {
    console.error('Error fetching barber metrics:', error);
    return null;
  }
}
