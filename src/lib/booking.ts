import type { Barber, BarberStaff, BookingSettings, ScheduleDay, Service, WeeklySchedule } from './types';

export const BOOKING_TIME_ZONE = 'America/Bogota';

export const DEFAULT_BOOKING_SETTINGS: BookingSettings = {
  minimumNoticeMinutes: 60,
  bookingHorizonDays: 30,
  slotIntervalMinutes: 30,
  exceptionalClosures: [],
};

const CLOSED_DAY: ScheduleDay = { enabled: false, start: '09:00', end: '18:00', breaks: [] };

export function getBookingSettings(barber: Barber): BookingSettings {
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
