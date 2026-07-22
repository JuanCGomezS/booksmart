// Tipos base del dominio de BookSmart.

import type { Timestamp } from 'firebase/firestore';

// Planes disponibles
export type Plan = 'standard' | 'plus' | 'extra';

// Ciclos de facturación
export type BillingCycle = 'month_1' | 'month_3' | 'month_12';

// Estados del negocio
export type BarberStatus = 'active' | 'trial' | 'expired';

export type BusinessType = 'barbershop' | 'hair_salon' | 'nail_studio' | 'dental_clinic' | 'other';

// Roles en el sistema
export type UserRole = 'client' | 'barber' | 'barber_admin' | 'superadmin';

// Estado de una cita
export type AppointmentStatus = 'pending' | 'confirmed' | 'cancelled' | 'done' | 'no_show';

/**
 * Documento principal del negocio (almacenado en la colección heredada)
 * Path: barbers/{barberId}
 */
export interface Barber {
  id: string;
  name: string;
  slug: string;
  /** Categoría visible del negocio. Los documentos anteriores usan barbershop por compatibilidad. */
  businessType: BusinessType;
  ownerId: string;
  ownerEmail?: string;
  plan: Plan;
  billingCycle: BillingCycle;
  
  // Control de membresía
  trialStartedAt: Timestamp;
  trialEndsAt: Timestamp;
  trialUsed: boolean;
  planExpiresAt: Timestamp; // vencimiento del plan pago
  
  // Estado
  active: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  
  // Límites según plan
  limits: {
    maxBarbers: number;
    maxProducts: number;
    maxGalleryItems: number;
  };
  
  // Configuración
  config: {
    address: string;
    phone: string;
    logoUrl?: string;
    coverUrl?: string;
    socialLinks?: {
      instagram?: string;
      facebook?: string;
      whatsapp?: string;
    };
    theme?: {
      primaryColor: string;
    };
  };
  
  // Horario de atención del local
  workingHours: {
    [day: number]: {
      open: string; // "09:00"
      close: string; // "18:00"
      enabled: boolean;
    };
  };
}

/**
 * Documento de usuario (auth)
 * Path: users/{uid}
 */
export interface User {
  uid: string;
  email: string;
  role: UserRole;
  barberId?: string; // para barber y barber_admin
  createdAt: Timestamp;
}

/**
 * Servicio / Corte
 * Path: barbers/{barberId}/services/{serviceId}
 */
export interface Service {
  id: string;
  name: string;
  description: string;
  duration: number; // en minutos
  price: number;
  imageUrl?: string;
  createdAt: Timestamp;
}

/**
 * Miembro del equipo / profesional
 * Path: barbers/{barberId}/barbers/{barberId}
 */
export interface BarberStaff {
  id: string;
  name: string;
  role?: string;
  photoUrl?: string;
  active: boolean;
  availability: {
    [day: number]: {
      slots: string[]; // ["09:00", "09:30", "10:00", ...]
    };
  };
  createdAt: Timestamp;
}

/**
 * Cita
 * Path: barbers/{barberId}/appointments/{appointmentId}
 */
export interface Appointment {
  id: string;
  clientName: string;
  clientPhone: string;
  barberId: string;
  serviceId: string;
  extraServices: string[];
  date: Timestamp;
  status: AppointmentStatus;
  notes?: string;
  createdAt: Timestamp;
}

/**
 * Item del catálogo (galería de cortes)
 * Path: barbers/{barberId}/catalog/{itemId}
 */
export interface CatalogItem {
  id: string;
  title: string;
  imageUrl: string;
  tags: string[];
  createdAt: Timestamp;
}

/**
 * Producto en venta
 * Path: barbers/{barberId}/products/{productId}
 */
export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  stock: number;
  imageUrl?: string;
  active: boolean;
  createdAt: Timestamp;
}

/**
 * Métrica básica para el dashboard del super admin
 */
export interface BarberMetrics {
  barberId: string;
  appointmentsThisMonth: number;
  activeProducts: number;
  activeBarbers: number;
  totalCatalogItems: number;
}
