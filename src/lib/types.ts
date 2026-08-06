// Tipos base del dominio de BookSmart.

import type { Timestamp } from 'firebase/firestore';

// Planes disponibles
export type Plan = 'standard' | 'plus' | 'extra';

// Ciclos de facturación
export type BillingCycle = 'month_1' | 'month_3' | 'month_12';

/** Canonical subscription state managed exclusively by Superadmin. */
export type SubscriptionStatus = 'active' | 'trial' | 'disabled';

// Estados del negocio
export type BarberStatus = SubscriptionStatus;

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

/** A booking can either name its professional or reserve compatible capacity pending assignment. */
export type AppointmentAssignmentState = 'assigned' | 'unassigned';

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
  /** Administrative-only; omitted from the public business projection. */
  reason?: string;
}

export interface WeeklyClosureRule {
  id: string;
  kind: 'weekly';
  weekday: number;
  /** Omit both bounds for a full-day closure. */
  startTime?: string;
  endTime?: string;
  /** Administrative-only; omitted from the public business projection. */
  reason?: string;
}

export interface DateClosureRule {
  id: string;
  kind: 'date';
  date: string; // YYYY-MM-DD in Colombia local time
  /** Omit both bounds for a full-day closure. */
  startTime?: string;
  endTime?: string;
  /** Administrative-only; omitted from the public business projection. */
  reason?: string;
}

export type ClosureRule = WeeklyClosureRule | DateClosureRule;

/** Business-controlled state for the fixed optional customer booking fields. */
export type BookingCustomerFieldState = 'disabled' | 'optional' | 'required';

/**
 * Fixed public-booking customer fields. Names and phone remain mandatory and
 * are deliberately not configurable.
 */
export interface BookingCustomerFields {
  email: BookingCustomerFieldState;
  address: BookingCustomerFieldState;
}

export interface BookingSettings {
  minimumNoticeMinutes: number;
  bookingHorizonDays: number;
  slotIntervalMinutes: number;
  /** Recurring or date-specific closures used by public availability. */
  closureRules: ClosureRule[];
  /** Legacy full-day date closures. Retained without data migration. */
  exceptionalClosures: ExceptionalClosure[];
  /** Optional customer data requested by this business during public booking. */
  customerFields: BookingCustomerFields;
  /** Whether clients can add public product interest to an appointment request. */
  productSelectionEnabled: boolean;
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
  /** Canonical subscription activation date. */
  subscriptionStartsAt: Timestamp;
  /** Canonical subscription state. `active` remains its derived operational mirror. */
  subscriptionStatus: SubscriptionStatus;
  /** Effective end date for the selected plan and billing cycle. */
  planExpiresAt: Timestamp;
  
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
    logoStoragePath?: string;
    coverStoragePath?: string;
    pendingBrandingCleanupPaths?: string[];
    placeUrl?: string;
    location?: BusinessCoordinates;
    socialLinks?: {
      instagram?: string;
      facebook?: string;
      whatsapp?: string;
    };
    theme?: {
      id?: import('./public-theme').PublicThemeId;
      primaryColor?: string;
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
 * `bookingEnabledUntil` is the non-sensitive effective booking cutoff used by
 * public clients; it does not expose subscription metadata.
 */
export interface PublicBusiness {
  id: string;
  name: string;
  slug: string;
  businessType: BusinessType;
  active: boolean;
  bookingEnabledUntil?: Timestamp;
  config: Pick<Barber['config'], 'address' | 'phone' | 'logoUrl' | 'coverUrl' | 'placeUrl' | 'location' | 'socialLinks' | 'theme' | 'booking'>;
  workingHours: Barber['workingHours'];
}

export type BusinessCoordinates = {
  latitude: number;
  longitude: number;
};

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
  /** Canonical business assignments. Staff has exactly one entry. */
  businessIds?: string[];
  /** Professional profile identifier when the account has one. */
  staffId?: string;
  /** Business containing a Storeadmin's optional professional profile; not an authorization assignment. */
  professionalBusinessId?: string;
  /** Temporary enrollment proof, removed atomically when a Storeadmin activates Staff. */
  enrollmentCode?: string;
  /** Minimal evidence that the customer accepted the current legal documents at registration. */
  legalConsent?: {
    version: string;
    acceptedAt: Timestamp;
  };
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
  /** Stored only when the business requests this fixed optional field. */
  clientEmail?: string;
  /** Stored only when the business requests this fixed optional field. */
  clientAddress?: string;
  /** Evidence of privacy-document acceptance when additional data is requested. */
  bookingPrivacyConsent?: {
    version: string;
    acceptedAt: Timestamp;
  };
  /** Omitted only while the business still needs to assign the appointment. */
  barberId?: string;
  /** Legacy assigned appointments omit this field and remain assigned. */
  assignmentState?: AppointmentAssignmentState;
  /** Private capacity holder for an unassigned appointment; never exposed publicly. */
  capacityStaffId?: string;
  serviceId: string;
  extraServices: string[];
  date: Timestamp;
  /** Colombia-local date used for bounded operational Agenda queries. */
  bookingDate?: string;
  startTime?: string;
  endTime?: string;
  status: AppointmentStatus;
  /** Optional private booking note visible only in authorized operational views. */
  notes?: string;
  /** Optional, informational product request; it never reserves inventory or price. */
  requestedProducts?: AppointmentProductRequest[];
  /** Present only when an authenticated customer made the booking. */
  customerUid?: string;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

/** Immutable product name and requested quantity captured with a private appointment. */
export interface AppointmentProductRequest {
  productId: string;
  name: string;
  quantity: number;
}

/** Commercial fields selected from an active canonical product for public UI. */
export interface PublicBookingProduct {
  id: string;
  name: string;
  /** Public optional commercial description. */
  description?: string;
  /** Public catalog price. It is never copied into appointment requests. */
  price: number;
  /** Optional commercial image. */
  imageUrl?: string;
  /** Optional commercial labels. */
  tags?: string[];
}

/** Strict booking-only service fields returned by the public callable. */
export type PublicBookingService = Pick<Service, 'id' | 'name' | 'duration' | 'bufferMinutes' | 'staffIds'> & {
  active: true;
};

/** Strict booking-only professional fields returned by the public callable. */
export type PublicBookingStaff = Pick<BarberStaff, 'id' | 'name' | 'schedule'> & {
  active: true;
};

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
  /** Optional so catalog documents created before descriptions remain valid. */
  description?: string;
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
  /** Optional so product documents created before descriptions remain valid. */
  description?: string;
  price: number;
  stock: number;
  imageUrl?: string;
  tags?: string[];
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
