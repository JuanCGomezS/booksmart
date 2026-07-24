import type { Barber, PublicBusiness } from './types';

export const PUBLIC_BUSINESSES_COLLECTION = 'publicBusinesses';

/** Creates the allowlisted document used by anonymous public pages. */
export function toPublicBusiness(business: Barber): Omit<PublicBusiness, 'id'> {
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
      ...(business.config.socialLinks ? { socialLinks: business.config.socialLinks } : {}),
      ...(business.config.theme ? { theme: business.config.theme } : {}),
      ...(business.config.booking ? { booking: business.config.booking } : {}),
    },
    workingHours: business.workingHours,
  };
}

/** Applies the same allowlist when decoding a public Firestore document. */
export function readPublicBusiness(data: Record<string, unknown>, id: string): PublicBusiness {
  const business = data as Omit<PublicBusiness, 'id'>;
  return {
    id,
    name: business.name,
    slug: business.slug,
    businessType: business.businessType,
    active: business.active,
    config: business.config,
    workingHours: business.workingHours,
  };
}
