import { DATA } from './data';
import type { StoredUserRole, UserRole } from './types';

/** Converts rollout-only values at the boundary; writes must use UserRole. */
export function normalizeUserRole(role: StoredUserRole | undefined): UserRole | null {
  switch (role) {
    case DATA.USER_ROLE.SUPERADMIN:
    case DATA.USER_ROLE.STOREADMIN:
    case DATA.USER_ROLE.STAFF:
    case DATA.USER_ROLE.CUSTOMER:
      return role;
    case 'barber_admin': return DATA.USER_ROLE.STOREADMIN;
    case 'barber': return DATA.USER_ROLE.STAFF;
    case 'client': return DATA.USER_ROLE.CUSTOMER;
    default: return null;
  }
}

export function isInternalRole(role: StoredUserRole | undefined): boolean {
  const canonical = normalizeUserRole(role);
  return canonical === DATA.USER_ROLE.SUPERADMIN || canonical === DATA.USER_ROLE.STOREADMIN || canonical === DATA.USER_ROLE.STAFF;
}
