import type { Barber, BusinessCoordinates, PublicBusiness } from './types';

export const PUBLIC_BUSINESSES_COLLECTION = 'publicBusinesses';

const DEFAULT_WORKING_HOURS = Object.fromEntries(
  Array.from({ length: 7 }, (_, day) => [day, { open: '09:00', close: '18:00', enabled: false }]),
) as Barber['workingHours'];
const VALID_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function normalizeBusinessCoordinates(value: unknown): BusinessCoordinates | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { latitude, longitude } = value as Partial<BusinessCoordinates>;
  if (typeof latitude !== 'number' || typeof longitude !== 'number' || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return undefined;
  return { latitude, longitude };
}

/** Retains only safe legacy location links while businesses migrate to coordinates. */
export function normalizeLegacyPlaceUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    const allowedHost = url.hostname === 'www.google.com' || url.hostname === 'maps.google.com';
    const allowedPath = url.pathname.startsWith('/maps/place/');
    const hasRuleAcceptedSuffix = url.pathname.length > '/maps/place/'.length || Boolean(url.search || url.hash);
    if (url.protocol !== 'https:' || !allowedHost || !allowedPath || !hasRuleAcceptedSuffix || url.username || url.password || url.port) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

/** Converts legacy or malformed schedules into the complete seven-day public contract. */
export function normalizeWorkingHours(workingHours: unknown): Barber['workingHours'] {
  const source = workingHours && typeof workingHours === 'object' ? workingHours as Record<number, unknown> : {};
  return Object.fromEntries(Array.from({ length: 7 }, (_, day) => {
    const candidate = source[day];
    if (!candidate || typeof candidate !== 'object') return [day, DEFAULT_WORKING_HOURS[day]];
    const schedule = candidate as Partial<Barber['workingHours'][number]>;
    if (typeof schedule.open !== 'string' || typeof schedule.close !== 'string' ||
      !VALID_TIME.test(schedule.open) || !VALID_TIME.test(schedule.close) || schedule.open >= schedule.close) {
      return [day, DEFAULT_WORKING_HOURS[day]];
    }
    return [day, { open: schedule.open, close: schedule.close, enabled: typeof schedule.enabled === 'boolean' ? schedule.enabled : false }];
  })) as Barber['workingHours'];
}

/** Creates the allowlisted document used by anonymous public pages. */
export function toPublicBusiness(business: Barber): Omit<PublicBusiness, 'id'> {
  const placeUrl = normalizeLegacyPlaceUrl(business.config.placeUrl);
  const location = normalizeBusinessCoordinates(business.config.location);
  return {
    name: business.name,
    slug: business.slug,
    businessType: business.businessType,
    active: business.active,
    config: {
      address: business.config.address,
      phone: business.config.phone,
      ...(business.config.logoUrl ? { logoUrl: business.config.logoUrl } : {}),
      ...(business.config.coverUrl ? { coverUrl: business.config.coverUrl } : {}),
      ...(placeUrl ? { placeUrl } : {}),
      ...(location ? { location } : {}),
      ...(business.config.socialLinks ? { socialLinks: business.config.socialLinks } : {}),
      ...(business.config.theme ? { theme: business.config.theme } : {}),
      ...(business.config.booking ? { booking: business.config.booking } : {}),
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
    config: {
      address: config.address || '',
      phone: config.phone || '',
      ...(config.logoUrl ? { logoUrl: config.logoUrl } : {}),
      ...(config.coverUrl ? { coverUrl: config.coverUrl } : {}),
      ...(placeUrl ? { placeUrl } : {}),
      ...(location ? { location } : {}),
      ...(config.socialLinks ? { socialLinks: config.socialLinks } : {}),
      ...(config.theme ? { theme: config.theme } : {}),
      ...(config.booking ? { booking: config.booking } : {}),
    },
    workingHours: normalizeWorkingHours(business.workingHours),
  };
}
