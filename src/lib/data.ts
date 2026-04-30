import type { BarberStatus, BillingCycle, Plan, UserRole } from './types';

export const DATA = {
  PLAN: {
    STANDARD: 'standard',
    PLUS: 'plus',
    EXTRA: 'extra',
  } as const,
  BILLING_CYCLE: {
    MONTH_1: 'month_1',
    MONTH_3: 'month_3',
    MONTH_12: 'month_12',
  } as const,
  BARBER_STATUS: {
    ACTIVE: 'active',
    TRIAL: 'trial',
    EXPIRED: 'expired',
  } as const,
  USER_ROLE: {
    CLIENT: 'client',
    BARBER: 'barber',
    BARBER_ADMIN: 'barber_admin',
    SUPERADMIN: 'superadmin',
  } as const,
  CONFIRM_ACTION: {
    DELETE: 'delete',
    TOGGLE: 'toggle',
    UPDATE_PLAN: 'updatePlan',
  } as const,
};

export const BILLING_CYCLE_LABEL: Record<BillingCycle, string> = {
  [DATA.BILLING_CYCLE.MONTH_1]: '1 mes',
  [DATA.BILLING_CYCLE.MONTH_3]: '3 meses',
  [DATA.BILLING_CYCLE.MONTH_12]: '12 meses',
};

export const PLAN_LABEL: Record<Plan, string> = {
  [DATA.PLAN.STANDARD]: 'Estándar',
  [DATA.PLAN.PLUS]: 'Plus',
  [DATA.PLAN.EXTRA]: 'Extra',
};

export const BARBER_STATUS_LABEL: Record<BarberStatus, string> = {
  [DATA.BARBER_STATUS.ACTIVE]: 'Activa',
  [DATA.BARBER_STATUS.TRIAL]: 'Prueba',
  [DATA.BARBER_STATUS.EXPIRED]: 'Expirada',
};

export const USER_ROLE_LABEL: Record<UserRole, string> = {
  [DATA.USER_ROLE.CLIENT]: 'Cliente',
  [DATA.USER_ROLE.BARBER]: 'Barbero',
  [DATA.USER_ROLE.BARBER_ADMIN]: 'Administrador barbería',
  [DATA.USER_ROLE.SUPERADMIN]: 'Superadministrador',
};
