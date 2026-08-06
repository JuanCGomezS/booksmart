import React, { useEffect, useMemo, useState } from 'react';
import { getBookingDate } from '../../../lib/booking';
import type { AppointmentStatus } from '../../../lib/types';
import { claimUnassignedAppointment } from '../../../lib/booking-transaction';
import { getWorkspaceMonthAgenda, isWorkspaceAgendaIndexError, updateWorkspaceAppointmentStatus, type WorkspaceAppointment } from '../../../lib/workspace';

const FINAL_STATUSES: Array<Extract<AppointmentStatus, 'done' | 'no_show' | 'cancelled'>> = ['done', 'no_show', 'cancelled'];
const STATUS_LABEL: Record<AppointmentStatus, string> = { pending: 'Pendiente', confirmed: 'Confirmada', cancelled: 'Cancelada', done: 'Realizada', no_show: 'No asistió' };
const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

function monthOf(date: string) { return date.slice(0, 7); }
function calendarDays(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  const total = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return Array.from({ length: first.getUTCDay() + total }, (_, index) => index < first.getUTCDay() ? null : `${month}-${String(index - first.getUTCDay() + 1).padStart(2, '0')}`);
}
function displayMonth(month: string) { return new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', month: 'long', year: 'numeric' }).format(new Date(`${month}-01T12:00:00Z`)); }
function displayDay(date: string) { return new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'full' }).format(new Date(`${date}T12:00:00Z`)); }
function moveMonth(month: string, amount: number) { const date = new Date(`${month}-01T12:00:00Z`); date.setUTCMonth(date.getUTCMonth() + amount); return date.toISOString().slice(0, 7); }
type LoadError = '' | 'index' | 'generic';

export default function AgendaPanel({ businessId, staffId }: { businessId: string; staffId?: string }) {
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
      setLoading(true); setLoadError('');
      try {
        const records = await getWorkspaceMonthAgenda(businessId, month, staffId);
        if (!cancelled) setAppointments(records);
      } catch (cause) {
        console.error(cause);
        if (!cancelled) setLoadError(isWorkspaceAgendaIndexError(cause) ? 'index' : 'generic');
      } finally { if (!cancelled) setLoading(false); }
    };
    void load(); return () => { cancelled = true; };
  }, [businessId, month, revision, staffId]);

  const counts = useMemo(() => appointments.reduce<Record<string, number>>((result, appointment) => ({ ...result, [appointment.bookingDate]: (result[appointment.bookingDate] || 0) + 1 }), {}), [appointments]);
  const selectedAppointments = useMemo(() => appointments.filter((appointment) => appointment.bookingDate === selectedDate), [appointments, selectedDate]);
  const days = useMemo(() => calendarDays(month), [month]);
  const selectMonth = (nextMonth: string) => { setMonth(nextMonth); setSelectedDate((current) => current.startsWith(nextMonth) ? current : `${nextMonth}-01`); };
  const retryLoad = () => setRevision((value) => value + 1);
  const updateStatus = async (appointment: WorkspaceAppointment, status: Extract<AppointmentStatus, 'done' | 'no_show' | 'cancelled'>) => {
    setUpdating(appointment.id);
    setUpdateErrors((current) => ({ ...current, [appointment.id]: '' }));
    try {
      await updateWorkspaceAppointmentStatus(businessId, appointment.id, status);
      setAppointments((items) => items.map((item) => item.id === appointment.id ? { ...item, status } : item));
    } catch (cause) {
      console.error(cause);
      setUpdateErrors((current) => ({ ...current, [appointment.id]: 'No fue posible actualizar el estado. Inténtalo nuevamente.' }));
    } finally { setUpdating(null); }
  };
  const claimAppointment = async (appointment: WorkspaceAppointment) => {
    if (!staffId) return;
    setUpdating(appointment.id);
    setUpdateErrors((current) => ({ ...current, [appointment.id]: '' }));
    try {
      const result = await claimUnassignedAppointment(businessId, appointment, staffId, { loadedAgenda: appointments });
      if (result.ok === false) {
        setUpdateErrors((current) => ({ ...current, [appointment.id]: result.message }));
        return;
      }
      setAppointments((items) => items.map((item) => item.id === appointment.id
        ? { ...item, assignmentState: 'assigned', barberId: staffId, capacityStaffId: undefined }
        : item));
    } catch (cause) {
      console.error(cause);
      setUpdateErrors((current) => ({ ...current, [appointment.id]: 'No fue posible asumir la solicitud. Inténtalo nuevamente.' }));
    } finally { setUpdating(null); }
  };

  return <section className="surface-card registration-mark rounded p-5 sm:p-6" aria-busy={loading}>
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="press-label accent-text">Registro operativo</p><h2 className="mt-2 text-xl font-bold text-main">Calendario de solicitudes</h2><p className="text-sm text-subtle">{staffId ? 'Tus solicitudes asignadas' : 'Todas las solicitudes del negocio'} · hora de Colombia.</p></div>
      <button type="button" className="btn-outline rounded px-3 py-2 text-sm" onClick={() => { setMonth(monthOf(today)); setSelectedDate(today); }}>Hoy</button>
    </div>
    <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(17rem,.8fr)]">
      <div>
        <div className="mb-4 flex items-center justify-between gap-2"><button type="button" className="btn-outline rounded px-3 py-2" aria-label="Mes anterior" onClick={() => selectMonth(moveMonth(month, -1))}>←</button><h3 className="text-base font-semibold capitalize text-main" aria-live="polite">{displayMonth(month)}</h3><button type="button" className="btn-outline rounded px-3 py-2" aria-label="Mes siguiente" onClick={() => selectMonth(moveMonth(month, 1))}>→</button></div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs text-subtle" aria-hidden="true">{WEEKDAYS.map((day) => <span key={day} className="py-2 font-semibold">{day}</span>)}</div>
        {loading ? <div className="grid grid-cols-7 gap-1" role="status" aria-label="Cargando calendario">{Array.from({ length: 35 }, (_, index) => <div key={index} className="h-14 animate-pulse rounded surface-soft" />)}</div> : <div className="grid grid-cols-7 gap-1" role="grid" aria-label={`Calendario de ${displayMonth(month)}`}>{days.map((day, index) => day ? <button key={day} type="button" role="gridcell" aria-selected={day === selectedDate} aria-label={`${displayDay(day)}, ${counts[day] || 0} solicitudes`} onClick={() => setSelectedDate(day)} className={`min-h-14 rounded border p-1 text-left text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${day === selectedDate ? 'border-[var(--secondary)] bg-[color-mix(in_srgb,var(--secondary)_12%,var(--surface))] text-main' : 'border-[var(--border)] text-main hover:bg-[var(--surface-soft)]'}`}><span className="block font-semibold">{Number(day.slice(-2))}</span>{counts[day] ? <span className="mt-1 block text-xs text-subtle">{counts[day]} {counts[day] === 1 ? 'solicitud' : 'solicitudes'}</span> : null}</button> : <span key={`blank-${index}`} aria-hidden="true" />)}</div>}
      </div>
      <aside className="border-t border-[var(--border)] pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
        <p className="press-label accent-text">Detalle del día</p><h3 className="mt-2 font-semibold capitalize text-main">{displayDay(selectedDate)}</h3>
        {loadError === 'index' && <div className="status-cancelled mt-4 rounded border p-3 text-sm" role="alert"><p>El calendario requiere índices de Firestore que todavía no están disponibles.</p><p className="mt-2">Despliega <code>firestore.indexes.json</code> y espera a que los índices de solicitudes terminen de crearse en Firebase Console.</p></div>}
        {loadError === 'generic' && <div className="status-cancelled mt-4 rounded border p-3 text-sm" role="alert"><p>No fue posible cargar las solicitudes de este mes.</p><button type="button" className="btn-outline mt-2 px-3 py-1 text-sm" onClick={retryLoad}>Reintentar</button></div>}
        {!loading && !loadError && (selectedAppointments.length === 0 ? <p className="surface-soft mt-4 rounded p-4 text-sm text-subtle">No hay solicitudes para este día. Selecciona otra fecha para revisar su agenda.</p> : <div className="mt-4 space-y-3">{selectedAppointments.map((appointment) => {
          const unassigned = appointment.assignmentState === 'unassigned';
          const requestedProducts = appointment.requestedProducts || [];
          const note = typeof appointment.notes === 'string' ? appointment.notes.trim() : '';
          return <article key={appointment.id} className="surface-soft rounded p-4">
            <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-semibold text-main">{appointment.startTime} – {appointment.endTime}</p><p className="mt-1 text-sm text-subtle">{appointment.clientName}</p>{unassigned && <p className="mt-1 text-sm font-semibold text-main">Por asignar</p>}</div><span className={`status-${appointment.status} rounded border px-2 py-1 text-xs font-semibold`}>{STATUS_LABEL[appointment.status]}</span></div>
            {requestedProducts.length > 0 && <div className="mt-3 border-t border-[var(--border)] pt-3"><p className="text-xs font-semibold uppercase tracking-wide text-subtle">Productos solicitados</p><ul className="mt-1 text-sm text-main">{requestedProducts.map((product) => <li key={product.productId}>{product.name} × {product.quantity}</li>)}</ul><p className="mt-1 text-xs text-subtle">Solicitud informativa; confirma disponibilidad y detalles con la persona.</p></div>}
            {note && <div className="mt-3 border-t border-[var(--border)] pt-3"><p className="text-xs font-semibold uppercase tracking-wide text-subtle">Nota de la persona</p><p className="mt-1 whitespace-pre-wrap break-words text-sm text-main">{note}</p></div>}
            <div className="mt-3 flex flex-wrap gap-2" aria-label={`Actualizar estado de la solicitud de ${appointment.clientName}`}>{unassigned && staffId ? <button type="button" disabled={updating === appointment.id} onClick={() => void claimAppointment(appointment)} className="btn-primary rounded px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50">{updating === appointment.id ? 'Asignando…' : 'Asumir solicitud'}</button> : FINAL_STATUSES.map((status) => <button key={status} type="button" disabled={updating === appointment.id || appointment.status === status} onClick={() => void updateStatus(appointment, status)} className="btn-outline rounded px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50">{updating === appointment.id ? 'Actualizando…' : STATUS_LABEL[status]}</button>)}</div>
            {updateErrors[appointment.id] && <p className="mt-3 text-sm text-main" role="alert" aria-live="polite">{updateErrors[appointment.id]}</p>}
          </article>;
        })}</div>)}
      </aside>
    </div>
  </section>;
}
