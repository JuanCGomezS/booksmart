import type {
  Barber,
  BarberStaff,
  BookingBlockingAppointmentStatus,
  BookingSettings,
  ScheduleDay,
  Service,
  WeeklySchedule,
} from './types';

export const BOOKING_TIME_ZONE = 'America/Bogota';

export const DEFAULT_BOOKING_SETTINGS: BookingSettings = {
  minimumNoticeMinutes: 60,
  bookingHorizonDays: 30,
  slotIntervalMinutes: 30,
  exceptionalClosures: [],
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
  const { timezone: _legacyTimezone, ...configured } = (barber.config?.booking || {}) as BookingSettings & { timezone?: string };
  return { ...DEFAULT_BOOKING_SETTINGS, ...configured, exceptionalClosures: configured.exceptionalClosures || [] };
}

/** Builds a Firestore dotted update so booking saves cannot replace sibling config. */
export function bookingSettingsUpdate(settings: BookingSettings): Record<'config.booking', BookingSettings> {
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

export function getStaffSchedule(staff: BarberStaff, workingHours: Barber['workingHours']): WeeklySchedule {
  if (staff.schedule) return staff.schedule;

  return Object.fromEntries(Array.from({ length: 7 }, (_, day) => {
    const businessDay = workingHours?.[day];
    return [day, businessDay ? { enabled: businessDay.enabled, start: businessDay.open, end: businessDay.close, breaks: [] } : CLOSED_DAY];
  })) as WeeklySchedule;
}

export function isServiceCompatibleWithStaff(service: Service, staffId: string): boolean {
  return service.staffIds === undefined || service.staffIds.includes(staffId);
}

export function checkBookingAvailability(input: BookingAvailabilityInput): BookingAvailability {
  const { business, service, staff, bookingDate, startTime } = input;
  if (!business.active) return { available: false, reason: 'business_inactive' };
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
