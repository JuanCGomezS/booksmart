import { collection, doc, getDocs, query, updateDoc, where } from 'firebase/firestore';
import { db } from './firebase';
import { getBogotaDateTime, parseBookingDate } from './booking';
import type { Appointment, AppointmentStatus } from './types';

export type WorkspaceAppointment = Appointment & {
  bookingDate: string;
  startTime: string;
  endTime: string;
};

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

function normalizeLegacyAppointment(id: string, data: LegacyAppointment, bookingDate: string): WorkspaceAppointment | null {
  const startsAt = toDate(data.date);
  if (!startsAt) return null;

  const startTime = toBogotaTime(startsAt);
  const durationMinutes = Number.isFinite(data.durationMinutes) && data.durationMinutes! > 0 ? data.durationMinutes! : 0;
  return {
    ...data,
    id,
    bookingDate,
    startTime,
    endTime: durationMinutes ? toBogotaTime(new Date(startsAt.getTime() + durationMinutes * 60 * 1000)) : startTime,
  };
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
  const [modernSnapshot, legacySnapshot] = await Promise.all([
    getDocs(query(appointments, ...modernConstraints)),
    getDocs(query(appointments, ...legacyConstraints)),
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

  return [...agenda.values()]
    .sort((left, right) => left.startTime.localeCompare(right.startTime));
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
