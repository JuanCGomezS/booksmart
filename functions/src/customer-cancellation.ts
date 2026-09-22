const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const cancellationDeadlineMs = 60 * 60 * 1_000;

type Appointment = {
  customerUid?: unknown;
  status?: unknown;
  bookingDate?: unknown;
  startTime?: unknown;
};

function bookingStartAt(bookingDate: unknown, startTime: unknown): Date | null {
  if (
    typeof bookingDate !== 'string' ||
    typeof startTime !== 'string' ||
    !datePattern.test(bookingDate) ||
    !timePattern.test(startTime)
  )
    return null;
  const [year, month, day] = bookingDate.split('-').map(Number);
  const [hour, minute] = startTime.split(':').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour + 5, minute));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null;
  return date;
}

export function canCustomerCancelAppointment(
  appointment: Appointment | undefined,
  customerUid: string,
  now = new Date(),
): boolean {
  if (
    !appointment ||
    appointment.customerUid !== customerUid ||
    !['pending', 'confirmed'].includes(appointment.status as string)
  )
    return false;
  const startAt = bookingStartAt(appointment.bookingDate, appointment.startTime);
  return Boolean(startAt && startAt.getTime() - now.getTime() > cancellationDeadlineMs);
}
