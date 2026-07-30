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
export type StoredUserRole = UserRole;

/** Safe, actionable failure categories for superadmin business creation. */
export type BusinessCreationErrorCode =
  | 'not-authenticated'
  | 'owner-not-found'
  | 'self-owner'
  | 'owner-not-customer'
  | 'owner-already-assigned'
  | 'permission-denied'
  | 'unavailable'
  | 'conflict'
  | 'unknown';

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
  /** The Staff member's only business assignment. */
  barberId?: string;
  /** Business assignments for a Storeadmin. Staff has exactly one matching entry. */
  businessIds?: string[];
  /** Professional profile identifier within barberId when the account has one. */
  staffId?: string;
  /** Business that contains the linked professional profile for a Storeadmin. */
  professionalBusinessId?: string;
  /** Temporary enrollment proof, removed atomically when a Storeadmin activates Staff. */
  enrollmentCode?: string;
  createdAt: Timestamp;
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
  photoUrl?: string;
  /** Storage metadata used by the content manager; photoUrl remains the public legacy field. */
  imageStoragePath?: string;
  /** Old immutable assets awaiting a successful client-side Storage deletion. */
  pendingImageCleanupPaths?: string[];
  active: boolean;
  /** Authenticated account linked to this professional profile. UID exposure is an accepted tradeoff. */
  accountUid?: string;
  /** Historical account binding; profiles with this field are not eligible for self-linking. */
  userId?: string;
  /** Account-bound Staff state. Legacy account-bound documents use the account UID as their ID. */
  accountStatus?: 'active' | 'inactive';
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
