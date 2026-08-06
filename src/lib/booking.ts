import type {
  Barber,
  BarberStaff,
  BookingBlockingAppointmentStatus,
  BookingCustomerFields,
  BookingSettings,
  ClosureRule,
  DateClosureRule,
  ScheduleDay,
  Service,
  WeeklyClosureRule,
  WeeklySchedule,
} from './types';

export const BOOKING_TIME_ZONE = 'America/Bogota';
/** Version accepted specifically for the additional public-booking data notice. */
export const BOOKING_PRIVACY_CONSENT_VERSION = '2026-08-01';

export const DEFAULT_BOOKING_CUSTOMER_FIELDS: BookingCustomerFields = {
  email: 'disabled',
  address: 'disabled',
};

export const DEFAULT_BOOKING_SETTINGS: BookingSettings = {
  minimumNoticeMinutes: 60,
  bookingHorizonDays: 30,
  slotIntervalMinutes: 30,
  closureRules: [],
  exceptionalClosures: [],
  customerFields: DEFAULT_BOOKING_CUSTOMER_FIELDS,
  productSelectionEnabled: false,
};

const CLOSED_DAY: ScheduleDay = { enabled: false, start: '09:00', end: '18:00', breaks: [] };
const BOGOTA_UTC_OFFSET_MINUTES = 5 * 60;

export const BOOKING_BLOCKING_STATUSES: readonly BookingBlockingAppointmentStatus[] = ['pending', 'confirmed'];

export interface BookingAvailabilityInput {
  business: Pick<Barber, 'active' | 'workingHours'> & { config: { booking?: BookingSettings } };
  service: Pick<Service, 'active' | 'duration' | 'bufferMinutes' | 'staffIds'>;
  staff: Pick<BarberStaff, 'active' | 'schedule'>;
  staffId: string;
  bookingDate: string;
  startTime: string;
  now?: Date;
}

export type BookingAvailabilityReason =
  | 'business_inactive'
  | 'service_inactive'
  | 'staff_inactive'
  | 'service_incompatible'
  | 'invalid_date'
  | 'outside_booking_window'
  | 'exceptional_closure'
  | 'closure_rule'
  | 'outside_schedule'
  | 'overlaps_break'
  | 'invalid_slot';

export type BookingAvailability =
  | { available: true; endTime: string }
  | { available: false; reason: BookingAvailabilityReason };

export interface BookingLockInterval {
  id: string;
  startTime: string;
  endTime: string;
}

export function getBookingSettings(barber: Pick<Barber, 'config'>): BookingSettings {
  return normalizeBookingSettings(barber.config?.booking);
}

/**
 * Keeps legacy public projections bookable while enforcing the explicit,
 * non-sensitive cutoff written with canonical subscription saves.
 */
export function isPublicBookingAvailable(
  business: Pick<Barber, 'active'> & { bookingEnabledUntil?: unknown },
  now = new Date(),
): boolean {
  if (!business.active) return false;
  if (business.bookingEnabledUntil === undefined) return true;

  const cutoff = business.bookingEnabledUntil instanceof Date
    ? business.bookingEnabledUntil
    : typeof business.bookingEnabledUntil === 'object' && business.bookingEnabledUntil !== null &&
        'toDate' in business.bookingEnabledUntil &&
        typeof (business.bookingEnabledUntil as { toDate?: unknown }).toDate === 'function'
      ? (business.bookingEnabledUntil as { toDate: () => Date }).toDate()
      : new Date(business.bookingEnabledUntil as string | number | Date);

  return Number.isFinite(cutoff.getTime()) && now <= cutoff;
}

/** Builds a Firestore dotted update so booking saves cannot replace sibling config. */
export function bookingSettingsUpdate(settings: BookingSettings): Record<'config.booking', BookingSettings> {
  if (!isValidBookingSettings(settings)) throw new Error('Invalid booking settings.');
  return { 'config.booking': settings };
}

export function getBookingDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BOOKING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function parseBookingDate(bookingDate: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(bookingDate);
  if (!match) return null;

  const [year, month, day] = match.slice(1).map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day
    ? { year, month, day }
    : null;
}

export function timeToMinutes(time: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return null;
  const [hours, minutes] = match.slice(1).map(Number);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

function normalizeReason(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() && value.trim().length <= 500 ? value.trim() : undefined;
}

function normalizeClosureRule(value: unknown): ClosureRule | null {
  if (!value || typeof value !== 'object') return null;
  const rule = value as Record<string, unknown>;
  const keys = Object.keys(rule);
  if (keys.some((key) => !['id', 'kind', 'weekday', 'date', 'startTime', 'endTime', 'reason'].includes(key))) return null;
  const id = typeof rule.id === 'string' && rule.id.trim() && rule.id.trim().length <= 120 ? rule.id.trim() : null;
  const kind = rule.kind;
  const startTime = typeof rule.startTime === 'string' ? rule.startTime : undefined;
  const endTime = typeof rule.endTime === 'string' ? rule.endTime : undefined;
  if (!id || (startTime === undefined) !== (endTime === undefined) ||
    (startTime !== undefined && (timeToMinutes(startTime) === null || timeToMinutes(endTime!) === null || startTime >= endTime!))) return null;

  const reason = normalizeReason(rule.reason);
  const common = { id, kind, ...(startTime ? { startTime, endTime } : {}), ...(reason ? { reason } : {}) };
  if (kind === 'weekly' && !('date' in rule) && Number.isInteger(rule.weekday) && (rule.weekday as number) >= 0 && (rule.weekday as number) <= 6) {
    return { ...common, kind, weekday: rule.weekday as number } as WeeklyClosureRule;
  }
  if (kind === 'date' && !('weekday' in rule) && typeof rule.date === 'string' && parseBookingDate(rule.date)) {
    return { ...common, kind, date: rule.date } as DateClosureRule;
  }
  return null;
}

/** A duplicate is the same recurrence target and the same full-day or partial interval. */
export function hasDuplicateClosureRuleScopes(rules: readonly ClosureRule[]): boolean {
  const scopes = new Set<string>();
  return rules.some((rule) => {
    const target = rule.kind === 'weekly' ? `weekly:${rule.weekday}` : `date:${rule.date}`;
    const interval = `${rule.startTime || ''}:${rule.endTime || ''}`;
    const scope = `${target}:${interval}`;
    if (scopes.has(scope)) return true;
    scopes.add(scope);
    return false;
  });
}

/** Legacy exceptional closures are full-day date closures and cannot share a date with a date rule. */
export function hasDateClosureRuleConflictingWithExceptionalClosures(
  rules: readonly ClosureRule[],
  exceptionalClosures: readonly BookingSettings['exceptionalClosures'][number][],
): boolean {
  const legacyDates = new Set(exceptionalClosures.map((closure) => closure.date));
  return rules.some((rule) => rule.kind === 'date' && legacyDates.has(rule.date));
}

function normalizeExceptionalClosures(value: unknown): BookingSettings['exceptionalClosures'] {
  if (!Array.isArray(value)) return [];
  const dates = new Set<string>();
  return value.flatMap((closure) => {
    if (!closure || typeof closure !== 'object') return [];
    const { date, reason } = closure as Record<string, unknown>;
    if (typeof date !== 'string' || !parseBookingDate(date) || dates.has(date)) return [];
    dates.add(date);
    return [{ date, ...(normalizeReason(reason) ? { reason: normalizeReason(reason) } : {}) }];
  });
}

/** Legacy configurations request no extra personal data until explicitly saved. */
export function normalizeBookingCustomerFields(value: unknown): BookingCustomerFields {
  const configured = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const normalize = (field: keyof BookingCustomerFields): BookingCustomerFields[typeof field] =>
    ['disabled', 'optional', 'required'].includes(configured[field] as string)
      ? configured[field] as BookingCustomerFields[typeof field]
      : DEFAULT_BOOKING_CUSTOMER_FIELDS[field];
  return { email: normalize('email'), address: normalize('address') };
}

export function bookingRequestsAdditionalCustomerData(fields: BookingCustomerFields): boolean {
  return fields.email !== 'disabled' || fields.address !== 'disabled';
}

export function isValidBookingCustomerFields(value: unknown): value is BookingCustomerFields {
  if (!value || typeof value !== 'object') return false;
  const fields = value as Record<string, unknown>;
  return Object.keys(fields).length === 2 &&
    ['email', 'address'].every((field) => ['disabled', 'optional', 'required'].includes(fields[field] as string));
}

/** Drops malformed persisted closure rules while retaining valid legacy settings. */
export function normalizeBookingSettings(value: unknown): BookingSettings {
  const configured = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const closureRules = Array.isArray(configured.closureRules)
    ? configured.closureRules.flatMap((rule) => {
      const normalized = normalizeClosureRule(rule);
      return normalized ? [normalized] : [];
    })
    : [];
  return {
    minimumNoticeMinutes: Number.isInteger(configured.minimumNoticeMinutes) && (configured.minimumNoticeMinutes as number) >= 0
      ? configured.minimumNoticeMinutes as number : DEFAULT_BOOKING_SETTINGS.minimumNoticeMinutes,
    bookingHorizonDays: Number.isInteger(configured.bookingHorizonDays) && (configured.bookingHorizonDays as number) >= 1
      ? configured.bookingHorizonDays as number : DEFAULT_BOOKING_SETTINGS.bookingHorizonDays,
    slotIntervalMinutes: Number.isInteger(configured.slotIntervalMinutes) && (configured.slotIntervalMinutes as number) >= 5 && (configured.slotIntervalMinutes as number) <= 120
      ? configured.slotIntervalMinutes as number : DEFAULT_BOOKING_SETTINGS.slotIntervalMinutes,
    closureRules,
    exceptionalClosures: normalizeExceptionalClosures(configured.exceptionalClosures),
    customerFields: normalizeBookingCustomerFields(configured.customerFields),
    productSelectionEnabled: configured.productSelectionEnabled === true,
  };
}

/** Validates the canonical booking-settings payload before it is persisted. */
export function isValidBookingSettings(value: unknown): value is BookingSettings {
  if (!value || typeof value !== 'object') return false;
  const settings = value as BookingSettings;
  const closureRuleIds = Array.isArray(settings.closureRules) ? settings.closureRules.map((rule) => rule?.id) : [];
  const exceptionalDates = Array.isArray(settings.exceptionalClosures) ? settings.exceptionalClosures.map((closure) => closure?.date) : [];
  const validExceptionalClosures = Array.isArray(settings.exceptionalClosures) && settings.exceptionalClosures.every((closure) =>
    closure && typeof closure.date === 'string' && Boolean(parseBookingDate(closure.date)) &&
    (closure.reason === undefined || (typeof closure.reason === 'string' && closure.reason.trim().length > 0 && closure.reason.trim().length <= 500)),
  ) && new Set(exceptionalDates).size === exceptionalDates.length;
  return Number.isInteger(settings.minimumNoticeMinutes) && settings.minimumNoticeMinutes >= 0 &&
    Number.isInteger(settings.bookingHorizonDays) && settings.bookingHorizonDays >= 1 &&
    Number.isInteger(settings.slotIntervalMinutes) && settings.slotIntervalMinutes >= 5 && settings.slotIntervalMinutes <= 120 &&
    Array.isArray(settings.closureRules) && settings.closureRules.length <= 100 &&
      new Set(closureRuleIds).size === closureRuleIds.length && settings.closureRules.every((rule) => normalizeClosureRule(rule) !== null) &&
       !hasDuplicateClosureRuleScopes(settings.closureRules) &&
    validExceptionalClosures &&
    isValidBookingCustomerFields(settings.customerFields) &&
    typeof settings.productSelectionEnabled === 'boolean' &&
    !hasDateClosureRuleConflictingWithExceptionalClosures(settings.closureRules, settings.exceptionalClosures);
}

/** Removes administrative closure reasons before a booking policy becomes public. */
export function toPublicBookingSettings(value: unknown): BookingSettings {
  const settings = normalizeBookingSettings(value);
  return {
    ...settings,
    closureRules: [
      ...settings.closureRules.map(({ reason: _reason, ...rule }) => rule),
      ...settings.exceptionalClosures.map(({ date }) => ({ id: `legacy-${date}`, kind: 'date' as const, date })),
    ],
    exceptionalClosures: [],
  };
}

/** Whether a date is unavailable for the full day under legacy or rule-based closures. */
export function isBookingDateFullyClosed(settings: Pick<BookingSettings, 'closureRules' | 'exceptionalClosures'>, bookingDate: string): boolean {
  if (settings.exceptionalClosures.some((closure) => closure.date === bookingDate)) return true;
  const weekday = getBookingWeekday(bookingDate);
  if (weekday === null) return false;
  return settings.closureRules.some((rule) =>
    !rule.startTime && !rule.endTime &&
    (rule.kind === 'date' ? rule.date === bookingDate : rule.weekday === weekday),
  );
}

function closureRuleOverlapsBooking(rule: ClosureRule, bookingDate: string, weekday: number, start: number, end: number): boolean {
  if ((rule.kind === 'weekly' && rule.weekday !== weekday) || (rule.kind === 'date' && rule.date !== bookingDate)) return false;
  const closureStart = rule.startTime ? timeToMinutes(rule.startTime) : 0;
  const closureEnd = rule.endTime ? timeToMinutes(rule.endTime) : 24 * 60;
  return closureStart !== null && closureEnd !== null && start < closureEnd && end > closureStart;
}

export function minutesToTime(minutes: number): string | null {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes >= 24 * 60) return null;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Returns the slot-aligned, half-open intervals occupied by a service and its
 * buffer. A partial final slot is locked in full so two services cannot overlap
 * inside a booking interval.
 */
export function getBookingLockIntervals(
  startTime: string,
  durationMinutes: number,
  bufferMinutes: number,
  slotIntervalMinutes: number,
): BookingLockInterval[] | null {
  const start = timeToMinutes(startTime);
  const occupiedMinutes = durationMinutes + bufferMinutes;
  if (
    start === null ||
    !Number.isInteger(durationMinutes) || durationMinutes <= 0 ||
    !Number.isInteger(bufferMinutes) || bufferMinutes < 0 ||
    !Number.isInteger(slotIntervalMinutes) || slotIntervalMinutes <= 0 ||
    start % slotIntervalMinutes !== 0
  ) return null;

  const end = start + occupiedMinutes;
  if (end > 24 * 60) return null;

  const intervals: BookingLockInterval[] = [];
  for (let intervalStart = start; intervalStart < end; intervalStart += slotIntervalMinutes) {
    const intervalEnd = Math.min(intervalStart + slotIntervalMinutes, 24 * 60);
    const intervalStartTime = minutesToTime(intervalStart);
    const intervalEndTime = minutesToTime(intervalEnd);
    if (!intervalStartTime || !intervalEndTime) return null;
    intervals.push({
      id: intervalStartTime.replace(':', ''),
      startTime: intervalStartTime,
      endTime: intervalEndTime,
    });
  }
  return intervals;
}

export function getBookingLockPath(businessId: string, bookingDate: string, staffId: string, intervalId: string): string {
  return `barbers/${businessId}/bookingLocks/${bookingDate}/staff/${staffId}/intervals/${intervalId}`;
}

export function hasBookingLockConflict(requiredIntervalIds: readonly string[], occupiedIntervalIds: ReadonlySet<string>): boolean {
  return requiredIntervalIds.some((intervalId) => occupiedIntervalIds.has(intervalId));
}

/** Converts a Colombia-local booking date and clock time into an instant. Colombia has no DST. */
export function getBogotaDateTime(bookingDate: string, time: string): Date | null {
  const date = parseBookingDate(bookingDate);
  const minutes = timeToMinutes(time);
  if (!date || minutes === null) return null;

  return new Date(Date.UTC(date.year, date.month - 1, date.day, 0, minutes + BOGOTA_UTC_OFFSET_MINUTES));
}

export function getBookingWeekday(bookingDate: string): number | null {
  const date = parseBookingDate(bookingDate);
  return date ? new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay() : null;
}

export function appointmentStatusBlocksAgenda(status: string): status is BookingBlockingAppointmentStatus {
  return (BOOKING_BLOCKING_STATUSES as readonly string[]).includes(status);
}

function validScheduleRange(start: unknown, end: unknown): start is string {
  const startMinutes = typeof start === 'string' ? timeToMinutes(start) : null;
  const endMinutes = typeof end === 'string' ? timeToMinutes(end) : null;
  return startMinutes !== null && endMinutes !== null && startMinutes < endMinutes;
}

/** Restores the complete schedule shape required by Firestore Rules from legacy data. */
export function normalizeWeeklySchedule(value: unknown): WeeklySchedule {
  const schedule = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return Object.fromEntries(Array.from({ length: 7 }, (_, day) => {
    const configured = schedule[day];
    const source = configured && typeof configured === 'object' ? configured as Record<string, unknown> : {};
    const configuredStart = typeof source.start === 'string' && timeToMinutes(source.start) !== null ? source.start : CLOSED_DAY.start;
    const configuredEnd = typeof source.end === 'string' && timeToMinutes(source.end) !== null ? source.end : CLOSED_DAY.end;
    const hasValidRange = validScheduleRange(configuredStart, configuredEnd);
    const start = hasValidRange ? configuredStart : CLOSED_DAY.start;
    const end = hasValidRange ? configuredEnd : CLOSED_DAY.end;
    const enabled = source.enabled === true && hasValidRange;
    const breaks = Array.isArray(source.breaks)
      ? source.breaks.flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const range = item as Record<string, unknown>;
        return typeof range.start === 'string' && typeof range.end === 'string' &&
          validScheduleRange(range.start, range.end) && range.start >= start && range.end <= end
          ? [{ start: range.start, end: range.end }]
          : [];
      })
      : [];
    return [day, { enabled, start, end, breaks }];
  })) as WeeklySchedule;
}

/** Returns the effective schedule: staff availability can narrow, never expand, business hours. */
export function getStaffSchedule(staff: BarberStaff, workingHours: Barber['workingHours']): WeeklySchedule {
  return Object.fromEntries(Array.from({ length: 7 }, (_, day) => {
    const businessDay = workingHours?.[day];
    if (!businessDay?.enabled || !validScheduleRange(businessDay.open, businessDay.close)) return [day, CLOSED_DAY];

    const staffDay = staff.schedule?.[day];
    if (!staffDay) return [day, { enabled: true, start: businessDay.open, end: businessDay.close, breaks: [] }];
    if (!staffDay.enabled || !validScheduleRange(staffDay.start, staffDay.end)) return [day, CLOSED_DAY];

    const start = timeToMinutes(staffDay.start)! > timeToMinutes(businessDay.open)! ? staffDay.start : businessDay.open;
    const end = timeToMinutes(staffDay.end)! < timeToMinutes(businessDay.close)! ? staffDay.end : businessDay.close;
    if (!validScheduleRange(start, end)) return [day, CLOSED_DAY];
    return [day, { enabled: true, start, end, breaks: Array.isArray(staffDay.breaks) ? staffDay.breaks : [] }];
  })) as WeeklySchedule;
}

export function isServiceCompatibleWithStaff(service: Pick<Service, 'staffIds'>, staffId: string): boolean {
  return service.staffIds === undefined || service.staffIds.includes(staffId);
}

export function checkBookingAvailability(input: BookingAvailabilityInput): BookingAvailability {
  const { business, service, staff, bookingDate, startTime } = input;
  if (!isPublicBookingAvailable(business, input.now)) return { available: false, reason: 'business_inactive' };
  if (service.active !== true) return { available: false, reason: 'service_inactive' };
  if (!staff.active) return { available: false, reason: 'staff_inactive' };
  if (!isServiceCompatibleWithStaff(service as Service, input.staffId)) return { available: false, reason: 'service_incompatible' };

  const date = parseBookingDate(bookingDate);
  const start = timeToMinutes(startTime);
  if (!date || start === null) return { available: false, reason: 'invalid_date' };

  const settings = getBookingSettings(business as Barber);
  const now = input.now || new Date();
  const requestedAt = getBogotaDateTime(bookingDate, startTime);
  const today = getBookingDate(now);
  const todayParts = parseBookingDate(today)!;
  const requestedDay = Date.UTC(date.year, date.month - 1, date.day);
  const todayDay = Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day);
  const horizonDays = (requestedDay - todayDay) / 86_400_000;
  if (!requestedAt || requestedAt.getTime() < now.getTime() + settings.minimumNoticeMinutes * 60_000 || horizonDays < 0 || horizonDays > settings.bookingHorizonDays) {
    return { available: false, reason: 'outside_booking_window' };
  }
  if (settings.exceptionalClosures.some((closure) => closure.date === bookingDate)) return { available: false, reason: 'exceptional_closure' };

  const weekday = getBookingWeekday(bookingDate)!;
  const schedule = getStaffSchedule(staff as BarberStaff, business.workingHours)[weekday];
  const duration = service.duration;
  const buffer = service.bufferMinutes || 0;
  const end = start + duration + buffer;
  if (settings.closureRules.some((rule) => closureRuleOverlapsBooking(rule, bookingDate, weekday, start, end))) {
    return { available: false, reason: 'closure_rule' };
  }
  const scheduleStart = timeToMinutes(schedule.start);
  const scheduleEnd = timeToMinutes(schedule.end);
  if (!schedule.enabled || scheduleStart === null || scheduleEnd === null || start < scheduleStart || end > scheduleEnd) {
    return { available: false, reason: 'outside_schedule' };
  }
  if (schedule.breaks.some((breakRange) => {
    const breakStart = timeToMinutes(breakRange.start);
    const breakEnd = timeToMinutes(breakRange.end);
    return breakStart !== null && breakEnd !== null && start < breakEnd && end > breakStart;
  })) return { available: false, reason: 'overlaps_break' };

  const endTime = minutesToTime(end);
  if (!endTime || !getBookingLockIntervals(startTime, duration, buffer, settings.slotIntervalMinutes)) {
    return { available: false, reason: 'invalid_slot' };
  }
  return { available: true, endTime };
}
