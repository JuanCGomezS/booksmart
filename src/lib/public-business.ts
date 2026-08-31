import { Timestamp } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from './firebase';
import type {
  Barber,
  BusinessCoordinates,
  PublicCatalogItem,
  PublicBookingProduct,
  PublicBookingService,
  PublicBookingStaff,
  PublicBusiness,
} from './types';
import { toPublicBookingSettings } from './booking';

export const PUBLIC_BUSINESSES_COLLECTION = 'publicBusinesses';

type PublicBusinessCallableResponse = {
  business: Record<string, unknown> & { id: string; bookingEnabledUntil?: string };
  products: PublicBookingProduct[];
  catalog?: PublicCatalogItem[];
  services: PublicBookingService[];
  staff: PublicBookingStaff[];
};

export type PublicBusinessPageData = {
  business: PublicBusiness;
  products: PublicBookingProduct[];
  catalog: PublicCatalogItem[];
  services: PublicBookingService[];
  staff: PublicBookingStaff[];
};

const DEFAULT_WORKING_HOURS = Object.fromEntries(
  Array.from({ length: 7 }, (_, day) => [day, { open: '09:00', close: '18:00', enabled: false }]),
) as Barber['workingHours'];
const VALID_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function toDate(value: unknown): Date | undefined {
  if (value instanceof Date) return value;
  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate?: unknown }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate();
  }

  const parsed = new Date(value as string | number | Date);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

/** Mirrors the canonical root-business operational contract without exposing subscription metadata. */
export function isBusinessOperational(
  business: {
    active?: unknown;
    subscriptionStatus?: unknown;
    subscriptionStartsAt?: unknown;
    planExpiresAt?: unknown;
  },
  now = new Date(),
): boolean {
  if (business.active !== true) return false;
  if (business.subscriptionStatus === undefined) return true;
  if (business.subscriptionStatus !== 'active' && business.subscriptionStatus !== 'trial')
    return false;

  const startsAt = toDate(business.subscriptionStartsAt);
  if (business.subscriptionStartsAt !== undefined && (!startsAt || startsAt > now)) return false;

  const expiresAt = toDate(business.planExpiresAt);
  return !expiresAt || expiresAt >= now;
}

/** Applies the public projection cutoff before a page is rendered or cached. */
export function isPublicBusinessOperational(
  business: {
    active?: unknown;
    bookingEnabledUntil?: unknown;
  },
  now = new Date(),
): boolean {
  if (business.active !== true) return false;
  if (business.bookingEnabledUntil === undefined) return true;
  const cutoff = toDate(business.bookingEnabledUntil);
  return Boolean(cutoff && cutoff >= now);
}

export function normalizeBusinessCoordinates(value: unknown): BusinessCoordinates | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { latitude, longitude } = value as Partial<BusinessCoordinates>;
  if (
    typeof latitude !== 'number' ||
    typeof longitude !== 'number' ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  )
    return undefined;
  return { latitude, longitude };
}

/** Retains only safe legacy location links while businesses migrate to coordinates. */
export function normalizeLegacyPlaceUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    const allowedHost = url.hostname === 'www.google.com' || url.hostname === 'maps.google.com';
    const allowedPath = url.pathname.startsWith('/maps/place/');
    const hasRuleAcceptedSuffix =
      url.pathname.length > '/maps/place/'.length || Boolean(url.search || url.hash);
    if (
      url.protocol !== 'https:' ||
      !allowedHost ||
      !allowedPath ||
      !hasRuleAcceptedSuffix ||
      url.username ||
      url.password ||
      url.port
    )
      return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

/** Converts legacy or malformed schedules into the complete seven-day public contract. */
export function normalizeWorkingHours(workingHours: unknown): Barber['workingHours'] {
  const source =
    workingHours && typeof workingHours === 'object'
      ? (workingHours as Record<number, unknown>)
      : {};
  return Object.fromEntries(
    Array.from({ length: 7 }, (_, day) => {
      const candidate = source[day];
      if (!candidate || typeof candidate !== 'object') return [day, DEFAULT_WORKING_HOURS[day]];
      const schedule = candidate as Partial<Barber['workingHours'][number]>;
      if (
        typeof schedule.open !== 'string' ||
        typeof schedule.close !== 'string' ||
        !VALID_TIME.test(schedule.open) ||
        !VALID_TIME.test(schedule.close) ||
        schedule.open >= schedule.close
      ) {
        return [day, DEFAULT_WORKING_HOURS[day]];
      }
      return [
        day,
        {
          open: schedule.open,
          close: schedule.close,
          enabled: typeof schedule.enabled === 'boolean' ? schedule.enabled : false,
        },
      ];
    }),
  ) as Barber['workingHours'];
}

/** Creates the allowlisted document used by anonymous public pages. */
export function toPublicBusiness(business: Barber): Omit<PublicBusiness, 'id'> {
  const config: Partial<Barber['config']> = business.config || {};
  const placeUrl = normalizeLegacyPlaceUrl(config.placeUrl);
  const location = normalizeBusinessCoordinates(config.location);
  const active = isBusinessOperational(business);
  const bookingEnabledUntil =
    active &&
    (business.subscriptionStatus === 'active' || business.subscriptionStatus === 'trial') &&
    business.planExpiresAt
      ? business.planExpiresAt
      : undefined;
  return {
    name: typeof business.name === 'string' ? business.name : '',
    slug: typeof business.slug === 'string' ? business.slug : '',
    businessType: typeof business.businessType === 'string' ? business.businessType : 'barbershop',
    active,
    ...(bookingEnabledUntil ? { bookingEnabledUntil } : {}),
    config: {
      address: config.address || '',
      phone: config.phone || '',
      ...(config.logoUrl ? { logoUrl: config.logoUrl } : {}),
      ...(config.coverUrl ? { coverUrl: config.coverUrl } : {}),
      ...(placeUrl ? { placeUrl } : {}),
      ...(location ? { location } : {}),
      ...(config.socialLinks ? { socialLinks: config.socialLinks } : {}),
      ...(config.theme ? { theme: config.theme } : {}),
      ...(config.booking ? { booking: toPublicBookingSettings(config.booking) } : {}),
    },
    workingHours: normalizeWorkingHours(business.workingHours),
  };
}

/** Applies the same allowlist when decoding a public Firestore document. */
export function readPublicBusiness(data: Record<string, unknown>, id: string): PublicBusiness {
  const business = data as Omit<PublicBusiness, 'id'>;
  const config = (business.config || {}) as PublicBusiness['config'];
  const location = normalizeBusinessCoordinates(config.location);
  const placeUrl = normalizeLegacyPlaceUrl(config.placeUrl);
  return {
    id,
    name: business.name,
    slug: business.slug,
    businessType: business.businessType,
    active: business.active,
    ...(business.bookingEnabledUntil ? { bookingEnabledUntil: business.bookingEnabledUntil } : {}),
    config: {
      address: config.address || '',
      phone: config.phone || '',
      ...(config.logoUrl ? { logoUrl: config.logoUrl } : {}),
      ...(config.coverUrl ? { coverUrl: config.coverUrl } : {}),
      ...(placeUrl ? { placeUrl } : {}),
      ...(location ? { location } : {}),
      ...(config.socialLinks ? { socialLinks: config.socialLinks } : {}),
      ...(config.theme ? { theme: config.theme } : {}),
      ...(config.booking ? { booking: toPublicBookingSettings(config.booking) } : {}),
    },
    workingHours: normalizeWorkingHours(business.workingHours),
  };
}

/** Loads the public page from the server-authorized callable, not anonymous Firestore reads. */
export async function loadPublicBusinessBySlug(slug: string): Promise<PublicBusinessPageData> {
  const request = httpsCallable<{ slug: string }, PublicBusinessCallableResponse>(
    getFunctions(app),
    'getPublicBusinessBySlug',
  );
  const response = await request({ slug });
  const payload = response.data;
  const expiresAt =
    typeof payload.business.bookingEnabledUntil === 'string'
      ? new Date(payload.business.bookingEnabledUntil)
      : null;
  const business = readPublicBusiness(
    {
      ...payload.business,
      active: true,
      ...(expiresAt && Number.isFinite(expiresAt.getTime())
        ? { bookingEnabledUntil: Timestamp.fromDate(expiresAt) }
        : {}),
    },
    payload.business.id,
  );

  return {
    business,
    products: (Array.isArray(payload.products) ? payload.products : []).filter(
      (product) =>
        typeof product.id === 'string' &&
        typeof product.name === 'string' &&
        typeof product.price === 'number' &&
        Number.isFinite(product.price),
    ),
    catalog: (Array.isArray(payload.catalog) ? payload.catalog : []).filter(
      (item) =>
        typeof item.id === 'string' &&
        typeof item.title === 'string' &&
        typeof item.imageUrl === 'string' &&
        Array.isArray(item.tags) &&
        item.tags.every((tag) => typeof tag === 'string'),
    ),
    services: (Array.isArray(payload.services) ? payload.services : []).filter(
      (service) =>
        typeof service.id === 'string' &&
        typeof service.name === 'string' &&
        typeof service.price === 'number' &&
        Number.isFinite(service.price) &&
        service.price >= 0 &&
        service.active === true &&
        Number.isInteger(service.duration) &&
        service.duration > 0 &&
        (service.bufferMinutes === undefined ||
          (Number.isInteger(service.bufferMinutes) && service.bufferMinutes >= 0)) &&
        (service.staffIds === undefined ||
          (Array.isArray(service.staffIds) &&
            service.staffIds.every((staffId) => typeof staffId === 'string'))),
    ),
    staff: (Array.isArray(payload.staff) ? payload.staff : []).filter(
      (member) =>
        typeof member.id === 'string' && typeof member.name === 'string' && member.active === true,
    ),
  };
}
