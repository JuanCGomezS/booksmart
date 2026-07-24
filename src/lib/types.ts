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
/** Canonical role values written by the application. */
export type UserRole = 'superadmin' | 'storeadmin' | 'staff' | 'customer';
/** Read-only rollout compatibility for documents not yet migrated. */
export type LegacyUserRole = 'barber_admin' | 'barber' | 'client';
export type StoredUserRole = UserRole | LegacyUserRole;

// Estado de una cita
export type AppointmentStatus = 'pending' | 'confirmed' | 'cancelled' | 'done' | 'no_show';

/** Appointment states that block staff availability. */
export type BookingBlockingAppointmentStatus = Extract<AppointmentStatus, 'pending' | 'confirmed'>;

export interface TimeRange {
  start: string;
  end: string;
}

export interface ScheduleDay {
  enabled: boolean;
  start: string;
  end: string;
  breaks: TimeRange[];
}

export type WeeklySchedule = Record<number, ScheduleDay>;

export interface ExceptionalClosure {
  date: string; // YYYY-MM-DD in Colombia local time
  reason?: string;
}

export interface BookingSettings {
  minimumNoticeMinutes: number;
  bookingHorizonDays: number;
  slotIntervalMinutes: number;
  exceptionalClosures: ExceptionalClosure[];
}

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
    /** Optional until a business configures public booking. */
    booking?: BookingSettings;
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
 * Safe, public-only projection of `barbers/{id}`.
 * Path: publicBusinesses/{businessId}
 *
 * Never add owner, plan, trial, limits, or other operational fields here.
 */
export interface PublicBusiness {
  id: string;
  name: string;
  slug: string;
  businessType: BusinessType;
  active: boolean;
  config: Pick<Barber['config'], 'address' | 'phone' | 'logoUrl' | 'coverUrl' | 'socialLinks' | 'theme' | 'booking'>;
  workingHours: Barber['workingHours'];
}

/**
 * Documento de usuario (auth)
 * Path: users/{uid}
 */
export interface User {
  uid: string;
  email: string;
  /** Optional profile name collected at registration; used for a generated staff record only when present. */
  name?: string;
  /** Optional external-auth display name, if a profile sync has stored one. */
  displayName?: string;
  role: StoredUserRole;
  /** Legacy primary business assignment. Kept while existing users are migrated. */
  barberId?: string;
  /** Explicit multi-business assignment for a business administrator. */
  businessIds?: string[];
  /** Internal staff-record links resolved automatically from the selected businesses. */
  staffAssignments?: StaffAssignment[];
  /** Legacy primary staff binding. Kept while existing users are migrated. */
  staffId?: string;
  createdAt: Timestamp;
}

export interface StaffAssignment {
  businessId: string;
  staffId: string;
}

/** Name-only option used by the superadmin business-assignment control. */
export interface BusinessAssignmentOption {
  id: string;
  name: string;
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
  /** Minutes blocked after the service before the professional can be booked again. */
  bufferMinutes?: number;
  /** Omitted in legacy records means every active professional is compatible. */
  staffIds?: string[];
  price: number;
  active?: boolean;
  imageUrl?: string;
  imageStoragePath?: string;
  /** Old immutable assets awaiting a successful client-side Storage deletion. */
  pendingImageCleanupPaths?: string[];
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
  /** Authenticated user automatically bound from a superadmin-selected business. */
  userId?: string;
  photoUrl?: string;
  /** Storage metadata used by the content manager; photoUrl remains the public legacy field. */
  imageStoragePath?: string;
  /** Old immutable assets awaiting a successful client-side Storage deletion. */
  pendingImageCleanupPaths?: string[];
  active: boolean;
  /** Legacy discrete slots. New schedules should use schedule. */
  availability?: {
    [day: number]: {
      slots: string[]; // ["09:00", "09:30", "10:00", ...]
    };
  };
  /** Work hours and breaks used by future availability calculation. */
  schedule?: WeeklySchedule;
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
  /** Colombia-local date used for bounded operational Agenda queries. */
  bookingDate?: string;
  startTime?: string;
  endTime?: string;
  status: AppointmentStatus;
  notes?: string;
  /** Present only when an authenticated customer made the booking. */
  customerUid?: string;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

/** Minimal, non-PII occupancy record used by public availability reads. */
export interface BookingLock {
  appointmentId: string;
  bookingDate: string;
  staffId: string;
  intervalId: string;
  startTime: string;
  endTime: string;
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
  imageStoragePath?: string;
  pendingImageCleanupPaths?: string[];
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
  imageStoragePath?: string;
  pendingImageCleanupPaths?: string[];
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
