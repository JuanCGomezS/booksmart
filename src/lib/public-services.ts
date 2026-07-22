import type { Service } from './types';

export const SERVICES_CACHE_TTL = 60 * 60 * 1000;

export type PublicServicesCache = { data: Service[]; expiresAt: number };

/** Only explicitly active services are public. Legacy records must be migrated. */
export function publicServicesOnly(services: Service[]): Service[] {
  return services.filter((service) => service.active === true);
}

export async function loadPublicServices(
  cache: PublicServicesCache | null,
  fetchActiveServices: () => Promise<Service[]>,
  now: number,
): Promise<{ services: Service[]; cache: PublicServicesCache | null }> {
  if (cache && now < cache.expiresAt) {
    return { services: publicServicesOnly(cache.data), cache: null };
  }

  const services = publicServicesOnly(await fetchActiveServices());
  return { services, cache: { data: services, expiresAt: now + SERVICES_CACHE_TTL } };
}
