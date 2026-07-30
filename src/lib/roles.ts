import { DATA } from './data';
import type { StoredUserRole, UserRole } from './types';

export function normalizeUserRole(role: StoredUserRole | undefined): UserRole | null {
  switch (role) {
    case DATA.USER_ROLE.SUPERADMIN:
    case DATA.USER_ROLE.STOREADMIN:
    case DATA.USER_ROLE.STAFF:
    case DATA.USER_ROLE.CUSTOMER:
      return role;
    default: return null;
  }
}

export function isInternalRole(role: StoredUserRole | undefined): boolean {
  const canonical = normalizeUserRole(role);
  return canonical === DATA.USER_ROLE.SUPERADMIN || canonical === DATA.USER_ROLE.STOREADMIN || canonical === DATA.USER_ROLE.STAFF;
}
