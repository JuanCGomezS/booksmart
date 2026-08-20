import React, { useEffect, useMemo, useState } from 'react';
import { getBogotaDateTime, getBookingDate } from '../../../lib/booking';
import type { AppointmentStatus } from '../../../lib/types';
import {
  claimStoreadminCapacityAppointment,
  claimUnassignedAppointment,
} from '../../../lib/booking-transaction';
import {
  getWorkspaceMonthAgenda,
  isWorkspaceAgendaIndexError,
  updateWorkspaceAppointmentStatus,
  type WorkspaceAppointment,
} from '../../../lib/workspace';

const FINAL_STATUSES: Array<Extract<AppointmentStatus, 'done' | 'no_show' | 'cancelled'>> = [
  'done',
  'no_show',
  'cancelled',
];
const STATUS_LABEL: Record<AppointmentStatus, string> = {
  pending: 'Pendiente',
  confirmed: 'Confirmada',
  cancelled: 'Cancelada',
  done: 'Realizada',
  no_show: 'No asistió',
};
const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

function monthOf(date: string) {
  return date.slice(0, 7);
}
function calendarDays(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  const total = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return Array.from({ length: first.getUTCDay() + total }, (_, index) =>
    index < first.getUTCDay()
      ? null
      : `${month}-${String(index - first.getUTCDay() + 1).padStart(2, '0')}`,
  );
}
function displayMonth(month: string) {
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${month}-01T12:00:00Z`));
}
function displayDay(date: string) {
  return new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'full' }).format(
    new Date(`${date}T12:00:00Z`),
  );
}
function displayTime(time: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return time;
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(`1970-01-01T${time}:00-05:00`));
}
function moveMonth(month: string, amount: number) {
  const date = new Date(`${month}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + amount);
  return date.toISOString().slice(0, 7);
}
function hasAppointmentEnded(bookingDate: string, endTime: string, now = new Date()) {
  const endsAt = getBogotaDateTime(bookingDate, endTime);
  return endsAt !== null && endsAt <= now;
}
type LoadError = '' | 'index' | 'generic';

export default function AgendaPanel({
  businessId,
  staffId,
  claimStaffId = staffId,
  profileName,
  staffNames = {},
  capacityConfirmationOnly = false,
}: {
  businessId: string;
  staffId?: string;
  claimStaffId?: string;
  profileName?: string;
  staffNames?: Readonly<Record<string, string>>;
  capacityConfirmationOnly?: boolean;
}) {
  const today = getBookingDate(new Date());
  const [month, setMonth] = useState(() => monthOf(today));
  const [selectedDate, setSelectedDate] = useState(today);
  const [appointments, setAppointments] = useState<WorkspaceAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<LoadError>('');
  const [revision, setRevision] = useState(0);
  const [updating, setUpdating] = useState<string | null>(null);
  const [updateErrors, setUpdateErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setLoadError('');
      try {
        const records = await getWorkspaceMonthAgenda(businessId, month, staffId);
        if (!cancelled) setAppointments(records);
      } catch (cause) {
        console.error(cause);
        if (!cancelled) setLoadError(isWorkspaceAgendaIndexError(cause) ? 'index' : 'generic');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [businessId, month, revision, staffId]);

  const counts = useMemo(
    () =>
      appointments.reduce<Record<string, number>>(
        (result, appointment) => ({
          ...result,
          [appointment.bookingDate]: (result[appointment.bookingDate] || 0) + 1,
        }),
        {},
      ),
    [appointments],
  );
  const selectedAppointments = useMemo(
    () => appointments.filter((appointment) => appointment.bookingDate === selectedDate),
    [appointments, selectedDate],
  );
  const days = useMemo(() => calendarDays(month), [month]);
  const selectMonth = (nextMonth: string) => {
    setMonth(nextMonth);
    setSelectedDate((current) => (current.startsWith(nextMonth) ? current : `${nextMonth}-01`));
  };
  const retryLoad = () => setRevision((value) => value + 1);
  const updateStatus = async (
    appointment: WorkspaceAppointment,
    status: Extract<AppointmentStatus, 'confirmed' | 'done' | 'no_show' | 'cancelled'>,
  ) => {
    setUpdating(appointment.id);
    setUpdateErrors((current) => ({ ...current, [appointment.id]: '' }));
    try {
      await updateWorkspaceAppointmentStatus(businessId, appointment.id, status);
      setAppointments((items) =>
        items.map((item) => (item.id === appointment.id ? { ...item, status } : item)),
      );
    } catch (cause) {
      console.error(cause);
      setUpdateErrors((current) => ({
        ...current,
        [appointment.id]: 'No fue posible actualizar el estado. Inténtalo nuevamente.',
      }));
    } finally {
      setUpdating(null);
    }
  };
  const claimAppointment = async (appointment: WorkspaceAppointment) => {
    if (!claimStaffId) return;
    setUpdating(appointment.id);
    setUpdateErrors((current) => ({ ...current, [appointment.id]: '' }));
    try {
      const result = capacityConfirmationOnly
        ? await claimStoreadminCapacityAppointment(businessId, appointment.id)
        : await claimUnassignedAppointment(businessId, appointment, claimStaffId, {
            loadedAgenda: appointments,
          });
      if (result.ok === false) {
        setUpdateErrors((current) => ({ ...current, [appointment.id]: result.message }));
        return;
      }
      setAppointments((items) =>
        items.map((item) =>
          item.id === appointment.id
            ? {
                ...item,
                assignmentState: 'assigned',
                barberId: claimStaffId,
                capacityStaffId: undefined,
              }
            : item,
        ),
      );
    } catch (cause) {
      console.error(cause);
      setUpdateErrors((current) => ({
        ...current,
        [appointment.id]: 'No fue posible asumir la solicitud. Inténtalo nuevamente.',
      }));
    } finally {
      setUpdating(null);
    }
  };

  return (
    <section className="surface-card registration-mark rounded p-5 sm:p-6" aria-busy={loading}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="press-label accent-text">Registro operativo</p>
          <h2 className="mt-2 text-xl font-bold text-main">Calendario de solicitudes</h2>
          <p className="text-sm text-subtle">
            {staffId ? 'Tus solicitudes asignadas' : 'Todas las solicitudes del negocio'} · hora de
            Colombia.
          </p>
        </div>
        <button
          type="button"
          className="btn-outline rounded px-3 py-2 text-sm"
          onClick={() => {
            setMonth(monthOf(today));
            setSelectedDate(today);
          }}
        >
          Hoy
        </button>
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(17rem,.8fr)]">
        <div>
          <div className="mb-4 flex items-center justify-between gap-2">
            <button
              type="button"
              className="btn-outline rounded px-3 py-2"
              aria-label="Mes anterior"
              onClick={() => selectMonth(moveMonth(month, -1))}
            >
              ←
            </button>
            <h3 className="text-base font-semibold capitalize text-main" aria-live="polite">
              {displayMonth(month)}
            </h3>
            <button
              type="button"
              className="btn-outline rounded px-3 py-2"
              aria-label="Mes siguiente"
              onClick={() => selectMonth(moveMonth(month, 1))}
            >
              →
            </button>
          </div>
          <div
            className="grid grid-cols-7 gap-1 text-center text-xs text-subtle"
            aria-hidden="true"
          >
            {WEEKDAYS.map((day) => (
              <span key={day} className="py-2 font-semibold">
                {day}
              </span>
            ))}
          </div>
          {loading ? (
            <div className="grid grid-cols-7 gap-1" role="status" aria-label="Cargando calendario">
              {Array.from({ length: 35 }, (_, index) => (
                <div key={index} className="h-14 animate-pulse rounded surface-soft" />
              ))}
            </div>
          ) : (
            <div
              className="grid grid-cols-7 gap-1"
              role="grid"
              aria-label={`Calendario de ${displayMonth(month)}`}
            >
              {days.map((day, index) =>
                day ? (
                  <button
                    key={day}
                    type="button"
                    role="gridcell"
                    aria-selected={day === selectedDate}
                    aria-label={`${displayDay(day)}, ${counts[day] || 0} solicitudes`}
                    onClick={() => setSelectedDate(day)}
                    className={`min-h-14 rounded border p-1 text-left text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${day === selectedDate ? 'border-[var(--secondary)] bg-[color-mix(in_srgb,var(--secondary)_12%,var(--surface))] text-main' : 'border-[var(--border)] text-main hover:bg-[var(--surface-soft)]'}`}
                  >
                    <span className="block font-semibold">{Number(day.slice(-2))}</span>
                    {counts[day] ? (
                      <span className="mt-1 block whitespace-nowrap text-xs leading-3 text-subtle sm:leading-normal">
                        {counts[day]} <span className="sm:hidden">sol.</span>
                        <span className="hidden sm:inline">
                          {counts[day] === 1 ? 'solicitud' : 'solicitudes'}
                        </span>
                      </span>
                    ) : null}
                  </button>
                ) : (
                  <span key={`blank-${index}`} aria-hidden="true" />
                ),
              )}
            </div>
          )}
        </div>
        <aside className="min-h-0 border-t border-[var(--border)] pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <p className="press-label accent-text">Detalle del día</p>
          <h3 className="mt-2 font-semibold capitalize text-main">{displayDay(selectedDate)}</h3>
          {loadError === 'index' && (
            <div className="status-cancelled mt-4 rounded border p-3 text-sm" role="alert">
              <p>El calendario requiere índices de Firestore que todavía no están disponibles.</p>
              <p className="mt-2">
                Despliega <code>firestore.indexes.json</code> y espera a que los índices de
                solicitudes terminen de crearse en Firebase Console.
              </p>
            </div>
          )}
          {loadError === 'generic' && (
            <div className="status-cancelled mt-4 rounded border p-3 text-sm" role="alert">
              <p>No fue posible cargar las solicitudes de este mes.</p>
              <button
                type="button"
                className="btn-outline mt-2 px-3 py-1 text-sm"
                onClick={retryLoad}
              >
                Reintentar
              </button>
            </div>
          )}
          {!loading &&
            !loadError &&
            (selectedAppointments.length === 0 ? (
              <p className="surface-soft mt-4 rounded p-4 text-sm text-subtle">
                No hay solicitudes para este día. Selecciona otra fecha para revisar su agenda.
              </p>
            ) : (
              <div
                className="mt-4 max-h-[min(60svh,40rem)] touch-pan-y overflow-y-auto overscroll-contain pr-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--secondary)]"
                role="region"
                aria-label="Lista de solicitudes del día"
                tabIndex={0}
              >
                <div className="space-y-3">
                  {selectedAppointments.map((appointment) => {
                    const unassigned = appointment.assignmentState === 'unassigned';
                    const canClaim =
                      unassigned &&
                      claimStaffId &&
                      (!capacityConfirmationOnly || appointment.capacityStaffId === claimStaffId);
                    const appointmentEnded = hasAppointmentEnded(
                      appointment.bookingDate,
                      appointment.endTime,
                    );
                    const requestedProducts = appointment.requestedProducts || [];
                    const note =
                      typeof appointment.notes === 'string' ? appointment.notes.trim() : '';
                    const serviceName =
                      typeof appointment.serviceName === 'string' && appointment.serviceName.trim()
                        ? appointment.serviceName.trim()
                        : 'Servicio no registrado';
                    const assignedName = appointment.barberId
                      ? staffNames[appointment.barberId]?.trim() ||
                        (appointment.barberId === staffId ? profileName?.trim() : '')
                      : '';
                    const assignmentLabel = unassigned
                      ? 'Por asignar'
                      : assignedName || 'Profesional asignado';
                    const phone = appointment.clientPhone.trim();
                    const email = appointment.clientEmail?.trim() || '';
                    const address = appointment.clientAddress?.trim() || '';
                    const contactCount =
                      Number(Boolean(phone)) + Number(Boolean(email)) + Number(Boolean(address));
                    const extraDetailCount = requestedProducts.length + (note ? 1 : 0);
                    const detailCount = contactCount + extraDetailCount;
                    const hasFinalStatusActions = appointmentEnded && !canClaim;
                    const hasExpandableDetails = detailCount > 0 || hasFinalStatusActions;
                    const detailsSummary = contactCount
                      ? `Contacto${extraDetailCount ? ' y detalles' : ''}${hasFinalStatusActions ? ' y cierre' : ''}`
                      : hasFinalStatusActions
                        ? 'Acciones de cierre'
                        : 'Detalles de la solicitud';
                    return (
                      <article
                        key={appointment.id}
                        className="overflow-hidden rounded border border-[var(--border)] bg-[var(--surface)] text-sm shadow-[var(--shadow)]"
                      >
                        <div className="grid grid-cols-[4.75rem_minmax(0,1fr)] gap-x-2.5 p-2.5">
                          <div className="self-start rounded border border-[color-mix(in_srgb,var(--secondary)_48%,var(--border))] bg-[color-mix(in_srgb,var(--secondary)_13%,var(--surface))] px-1.5 py-2 text-center">
                            <p className="whitespace-nowrap text-xs font-bold leading-none text-main tabular-nums">
                              {displayTime(appointment.startTime)}
                            </p>
                            <p className="mt-1 whitespace-nowrap text-xs leading-none tabular-nums text-subtle">
                              {displayTime(appointment.endTime)}
                            </p>
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <p
                                className="min-w-0 truncate font-semibold leading-5 text-main"
                                title={serviceName}
                              >
                                {serviceName}
                              </p>
                              <span
                                className={`shrink-0 rounded border px-1.5 py-0.5 text-xs font-semibold leading-4 ${`status-${appointment.status}`}`}
                              >
                                {STATUS_LABEL[appointment.status]}
                              </span>
                            </div>
                            <p
                              className="truncate text-xs leading-4 text-subtle"
                              title={`${appointment.clientName} · ${assignmentLabel}`}
                            >
                              <span>{appointment.clientName}</span>
                              <span aria-hidden="true"> · </span>
                              <span
                                className={unassigned ? 'font-semibold accent-text' : undefined}
                              >
                                {assignmentLabel}
                              </span>
                            </p>
                          </div>
                        </div>

                        {hasExpandableDetails && (
                          <details className="group bg-[color-mix(in_srgb,var(--surface-soft)_58%,var(--surface))]">
                            <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 px-2.5 text-xs font-semibold text-main marker:hidden hover:bg-[var(--surface-soft)]">
                              <span className="flex min-w-0 items-center gap-1.5">
                                <span
                                  aria-hidden="true"
                                  className="grid size-4 place-items-center rounded border border-current text-xs leading-none"
                                >
                                  ⌁
                                </span>
                                {detailsSummary}{' '}
                                {detailCount > 0 && (
                                  <span className="text-subtle">· {detailCount}</span>
                                )}
                              </span>
                              <span className="shrink-0 text-subtle group-open:hidden">Ver</span>
                              <span className="hidden shrink-0 text-subtle group-open:inline">
                                Ocultar
                              </span>
                            </summary>
                            <div className="space-y-2 border-t border-[color-mix(in_srgb,var(--border)_72%,transparent)] px-2.5 py-2.5">
                              {phone && (
                                <a
                                  className="block truncate font-medium text-main underline decoration-[var(--border)] underline-offset-2 hover:decoration-current"
                                  href={`tel:${phone}`}
                                  aria-label={`Llamar a ${appointment.clientName}: ${phone}`}
                                  title={phone}
                                >
                                  {phone}
                                </a>
                              )}
                              {email && (
                                <a
                                  className="block truncate text-subtle underline decoration-[var(--border)] underline-offset-2 hover:text-main hover:decoration-current"
                                  href={`mailto:${email}`}
                                  aria-label={`Enviar correo a ${appointment.clientName}: ${email}`}
                                  title={email}
                                >
                                  {email}
                                </a>
                              )}
                              {address && (
                                <a
                                  className="block truncate text-subtle underline decoration-[var(--border)] underline-offset-2 hover:text-main hover:decoration-current"
                                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  aria-label={`Abrir dirección de ${appointment.clientName} en el mapa: ${address}`}
                                  title={address}
                                >
                                  {address}
                                </a>
                              )}
                              {requestedProducts.length > 0 && (
                                <div
                                  className={
                                    contactCount ? 'border-t border-[var(--border)] pt-2' : ''
                                  }
                                >
                                  <p className="text-xs font-semibold uppercase tracking-wide text-subtle">
                                    Productos solicitados
                                  </p>
                                  <p className="mt-0.5 text-xs text-subtle">
                                    Solo informativos; no reservan inventario.
                                  </p>
                                  <ul className="mt-1 space-y-1 text-sm text-main">
                                    {requestedProducts.map((product) => (
                                      <li key={product.productId} className="break-words">
                                        {product.name} × {product.quantity}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {note && (
                                <div
                                  className={
                                    contactCount || requestedProducts.length
                                      ? 'border-t border-[var(--border)] pt-2'
                                      : ''
                                  }
                                >
                                  <p className="text-xs font-semibold uppercase tracking-wide text-subtle">
                                    Nota de la persona
                                  </p>
                                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-main">
                                    {note}
                                  </p>
                                </div>
                              )}
                              {hasFinalStatusActions && (
                                <div
                                  role="group"
                                  className={
                                    detailCount ? 'border-t border-[var(--border)] pt-2' : ''
                                  }
                                  aria-label={`Actualizar estado de la solicitud de ${appointment.clientName}`}
                                >
                                  <p className="text-xs font-semibold uppercase tracking-wide text-subtle">
                                    Cierre de la solicitud
                                  </p>
                                  <div className="mt-2 flex gap-1.5 overflow-x-auto pb-px">
                                    {FINAL_STATUSES.map((status) => (
                                      <button
                                        key={status}
                                        type="button"
                                        disabled={
                                          updating === appointment.id ||
                                          appointment.status === status
                                        }
                                        onClick={() => void updateStatus(appointment, status)}
                                        className="btn-outline min-h-11 shrink-0 rounded px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        {updating === appointment.id
                                          ? 'Actualizando…'
                                          : STATUS_LABEL[status]}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </details>
                        )}

                        {appointment.status === 'pending' && !canClaim && (
                          <div className="bg-[color-mix(in_srgb,var(--accent)_8%,var(--surface))] px-2.5 py-2">
                            <button
                              type="button"
                              disabled={updating === appointment.id}
                              onClick={() => void updateStatus(appointment, 'confirmed')}
                              className="btn-primary min-h-11 rounded px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {updating === appointment.id
                                ? 'Actualizando…'
                                : 'Aprobar agendamiento'}
                            </button>
                          </div>
                        )}
                        {canClaim && (
                          <div
                            className="bg-[color-mix(in_srgb,var(--accent)_8%,var(--surface))] px-2.5 py-2"
                            aria-label={`Actualizar estado de la solicitud de ${appointment.clientName}`}
                          >
                            <button
                              type="button"
                              disabled={updating === appointment.id}
                              onClick={() => void claimAppointment(appointment)}
                              className="btn-primary min-h-11 rounded px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {updating === appointment.id
                                ? 'Asignando…'
                                : appointment.capacityStaffId === claimStaffId
                                  ? 'Confirmar'
                                  : 'Asumir'}
                            </button>
                          </div>
                        )}
                        {updateErrors[appointment.id] && (
                          <p
                            className="border-t border-[var(--border)] px-2.5 py-2 text-sm text-main"
                            role="alert"
                            aria-live="polite"
                          >
                            {updateErrors[appointment.id]}
                          </p>
                        )}
                      </article>
                    );
                  })}
                </div>
              </div>
            ))}
        </aside>
      </div>
    </section>
  );
}
