import { collection, doc, getDocs, query, updateDoc, where } from 'firebase/firestore';
import { db } from './firebase';
import { getBogotaDateTime, getBookingDate, parseBookingDate } from './booking';
import type { Appointment, AppointmentStatus } from './types';

export type WorkspaceAppointment = Appointment & {
  bookingDate: string;
  startTime: string;
  endTime: string;
};

/** Identifies the Firestore error returned when a composite query index is not ready. */
export function isWorkspaceAgendaIndexError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;

  const { code, message } = error as { code?: unknown; message?: unknown };
  return code === 'failed-precondition'
    && typeof message === 'string'
    && /the query requires an index\.\s+you can create it here:\s+https:\/\/console\.firebase\.google\.com\//i.test(message);
}

type LegacyAppointment = Appointment & { durationMinutes?: number };

function getNextBookingDate(bookingDate: string): string | null {
  const date = parseBookingDate(bookingDate);
  if (!date) return null;

  return new Date(Date.UTC(date.year, date.month - 1, date.day + 1)).toISOString().slice(0, 10);
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }

  return null;
}

function toBogotaTime(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.hour}:${values.minute}`;
}

function normalizeLegacyAppointment(id: string, data: LegacyAppointment, bookingDate?: string): WorkspaceAppointment | null {
  const startsAt = toDate(data.date);
  if (!startsAt) return null;

  const startTime = toBogotaTime(startsAt);
  const durationMinutes = Number.isFinite(data.durationMinutes) && data.durationMinutes! > 0 ? data.durationMinutes! : 0;
  return {
    ...data,
    id,
    bookingDate: bookingDate || getBookingDate(startsAt),
    startTime,
    endTime: durationMinutes ? toBogotaTime(new Date(startsAt.getTime() + durationMinutes * 60 * 1000)) : startTime,
  };
}

function monthRange(month: string): { start: string; end: string; legacyStart: Date; legacyEnd: Date } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return null;

  const start = `${match[1]}-${match[2]}-01`;
  const next = new Date(Date.UTC(year, monthIndex + 1, 1));
  const end = next.toISOString().slice(0, 10);
  const legacyStart = getBogotaDateTime(start, '00:00');
  const legacyEnd = getBogotaDateTime(end, '00:00');
  return legacyStart && legacyEnd ? { start, end, legacyStart, legacyEnd } : null;
}

/** Reads one Colombia-local day only. Staff queries must include their assigned legacy barberId. */
export async function getWorkspaceAgenda(
  businessId: string,
  bookingDate: string,
  staffId?: string,
): Promise<WorkspaceAppointment[]> {
  const nextBookingDate = getNextBookingDate(bookingDate);
  const legacyDayStart = getBogotaDateTime(bookingDate, '00:00');
  const legacyNextDayStart = nextBookingDate ? getBogotaDateTime(nextBookingDate, '00:00') : null;
  if (!legacyDayStart || !legacyNextDayStart) return [];

  const appointments = collection(db, 'barbers', businessId, 'appointments');
  const modernConstraints = [where('bookingDate', '==', bookingDate)];
  const legacyConstraints = [
    where('date', '>=', legacyDayStart),
    where('date', '<', legacyNextDayStart),
  ];
  if (staffId) {
    const staffConstraint = where('barberId', '==', staffId);
    modernConstraints.push(staffConstraint);
    legacyConstraints.push(staffConstraint);
  }

  // Keep the migration read bounded: one modern date equality query and one
  // legacy Timestamp range query. Prefer the modern shape when a document has both.
  const [modernSnapshot, legacySnapshot, unassignedSnapshot] = await Promise.all([
    getDocs(query(appointments, ...modernConstraints)),
    getDocs(query(appointments, ...legacyConstraints)),
    staffId ? getDocs(query(appointments, where('assignmentState', '==', 'unassigned'), where('bookingDate', '==', bookingDate))) : Promise.resolve(null),
  ]);
  const agenda = new Map<string, WorkspaceAppointment>();
  modernSnapshot.docs.forEach((item) => {
    agenda.set(item.id, { id: item.id, ...item.data() } as WorkspaceAppointment);
  });
  legacySnapshot.docs.forEach((item) => {
    if (agenda.has(item.id)) return;
    const normalized = normalizeLegacyAppointment(item.id, item.data() as LegacyAppointment, bookingDate);
    if (normalized) agenda.set(item.id, normalized);
  });
  unassignedSnapshot?.docs.forEach((item) => agenda.set(item.id, { id: item.id, ...item.data() } as WorkspaceAppointment));

  return [...agenda.values()]
    .sort((left, right) => left.startTime.localeCompare(right.startTime));
}

/**
 * Reads a single Colombia-local calendar month with two bounded queries: one
 * for modern `bookingDate` records and one for legacy Timestamp records.
 * Document IDs are deduplicated so migrated records remain visible once.
 */
export async function getWorkspaceMonthAgenda(
  businessId: string,
  month: string,
  staffId?: string,
): Promise<WorkspaceAppointment[]> {
  const range = monthRange(month);
  if (!range) return [];

  const appointments = collection(db, 'barbers', businessId, 'appointments');
  const modernConstraints = [where('bookingDate', '>=', range.start), where('bookingDate', '<', range.end)];
  const legacyConstraints = [where('date', '>=', range.legacyStart), where('date', '<', range.legacyEnd)];
  if (staffId) {
    const staffConstraint = where('barberId', '==', staffId);
    modernConstraints.push(staffConstraint);
    legacyConstraints.push(staffConstraint);
  }

  const [modernSnapshot, legacySnapshot, unassignedSnapshot] = await Promise.all([
    getDocs(query(appointments, ...modernConstraints)),
    getDocs(query(appointments, ...legacyConstraints)),
    staffId ? getDocs(query(appointments, where('assignmentState', '==', 'unassigned'), where('bookingDate', '>=', range.start), where('bookingDate', '<', range.end))) : Promise.resolve(null),
  ]);
  const agenda = new Map<string, WorkspaceAppointment>();
  modernSnapshot.docs.forEach((item) => {
    agenda.set(item.id, { id: item.id, ...item.data() } as WorkspaceAppointment);
  });
  legacySnapshot.docs.forEach((item) => {
    if (agenda.has(item.id)) return;
    const normalized = normalizeLegacyAppointment(item.id, item.data() as LegacyAppointment);
    if (normalized) agenda.set(item.id, normalized);
  });
  unassignedSnapshot?.docs.forEach((item) => agenda.set(item.id, { id: item.id, ...item.data() } as WorkspaceAppointment));

  return [...agenda.values()].sort((left, right) =>
    left.bookingDate.localeCompare(right.bookingDate) || left.startTime.localeCompare(right.startTime),
  );
}

export async function updateWorkspaceAppointmentStatus(
  businessId: string,
  appointmentId: string,
  status: Extract<AppointmentStatus, 'done' | 'no_show' | 'cancelled'>,
): Promise<void> {
  await updateDoc(doc(db, 'barbers', businessId, 'appointments', appointmentId), {
    status,
    updatedAt: new Date(),
  });
}
