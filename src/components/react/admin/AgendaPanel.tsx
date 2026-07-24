import React, { useEffect, useMemo, useState } from 'react';
import { getBookingDate } from '../../../lib/booking';
import type { AppointmentStatus } from '../../../lib/types';
import { getWorkspaceAgenda, updateWorkspaceAppointmentStatus, type WorkspaceAppointment } from '../../../lib/workspace';

const FINAL_STATUSES: Array<Extract<AppointmentStatus, 'done' | 'no_show' | 'cancelled'>> = ['done', 'no_show', 'cancelled'];
const STATUS_LABEL: Record<AppointmentStatus, string> = { pending: 'Pendiente', confirmed: 'Confirmada', cancelled: 'Cancelada', done: 'Realizada', no_show: 'No asistió' };
const CACHE_TTL_MS = 60 * 1000;
function cacheKey(businessId: string, date: string, staffId?: string) { return `workspace_agenda_${businessId}_${date}_${staffId || 'business'}`; }

export default function AgendaPanel({ businessId, staffId }: { businessId: string; staffId?: string }) {
  const [date, setDate] = useState(() => getBookingDate(new Date()));
  const [appointments, setAppointments] = useState<WorkspaceAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [updating, setUpdating] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false; let timer: number | undefined; const key = cacheKey(businessId, date, staffId);
    const load = async () => {
      setLoading(true); setError('');
      try {
        const cached = JSON.parse(sessionStorage.getItem(key) || 'null') as { appointments?: WorkspaceAppointment[]; expiresAt?: number } | null;
        if (cached?.appointments && cached.expiresAt && cached.expiresAt > Date.now()) {
          if (!cancelled) setAppointments(cached.appointments);
          timer = window.setTimeout(() => setRevision((value) => value + 1), cached.expiresAt - Date.now()); return;
        }
        const records = await getWorkspaceAgenda(businessId, date, staffId);
        const expiresAt = Date.now() + CACHE_TTL_MS;
        sessionStorage.setItem(key, JSON.stringify({ appointments: records, expiresAt }));
        if (!cancelled) { setAppointments(records); timer = window.setTimeout(() => setRevision((value) => value + 1), CACHE_TTL_MS); }
      } catch (cause) { console.error(cause); if (!cancelled) setError('No fue posible cargar las citas de este día.'); }
      finally { if (!cancelled) setLoading(false); }
    };
    void load(); return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [businessId, date, revision, staffId]);
  const summary = useMemo(() => appointments.reduce<Record<string, number>>((counts, appointment) => ({ ...counts, [appointment.status]: (counts[appointment.status] || 0) + 1 }), {}), [appointments]);
  const updateStatus = async (appointment: WorkspaceAppointment, status: Extract<AppointmentStatus, 'done' | 'no_show' | 'cancelled'>) => {
    setUpdating(appointment.id); setError('');
    try { await updateWorkspaceAppointmentStatus(businessId, appointment.id, status); sessionStorage.removeItem(cacheKey(businessId, date, staffId)); setAppointments((items) => items.map((item) => item.id === appointment.id ? { ...item, status } : item)); setRevision((value) => value + 1); }
    catch (cause) { console.error(cause); setError('No fue posible actualizar el estado de la cita.'); } finally { setUpdating(null); }
  };
  return <section className="surface-card rounded-2xl p-5 sm:p-6"><div className="flex flex-wrap items-end justify-between gap-4"><div><h2 className="text-xl font-bold text-main">Agenda del día</h2><p className="text-sm text-subtle">Sólo citas del día seleccionado en hora de Colombia.</p></div><label className="block"><span className="field-label mb-1 block text-sm font-medium">Fecha</span><input className="field-input" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label></div>{error && <p className="mt-4 rounded-lg p-3 text-sm" style={{ background: 'color-mix(in srgb, #ef4444 14%, var(--surface))', color: '#fecaca' }}>{error}</p>}<div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5"><Card label="Total" value={appointments.length} />{(Object.keys(STATUS_LABEL) as AppointmentStatus[]).map((status) => <Card key={status} label={STATUS_LABEL[status]} value={summary[status] || 0} />)}</div>{loading ? <p className="mt-6 text-sm text-subtle">Cargando agenda...</p> : <div className="mt-6 space-y-3">{appointments.length === 0 ? <p className="surface-soft rounded-xl p-4 text-sm text-subtle">No hay citas para este día.</p> : appointments.map((appointment) => <article key={appointment.id} className="surface-soft flex flex-wrap items-center justify-between gap-4 rounded-xl p-4"><div><p className="font-semibold text-main">{appointment.startTime} – {appointment.endTime}</p><p className="text-sm text-subtle">{appointment.clientName}</p><p className="text-xs text-subtle">Estado: {STATUS_LABEL[appointment.status]}</p></div>{staffId && <div className="flex flex-wrap gap-2">{FINAL_STATUSES.map((status) => <button key={status} type="button" disabled={updating === appointment.id || appointment.status === status} onClick={() => void updateStatus(appointment, status)} className="btn-outline rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50">{STATUS_LABEL[status]}</button>)}</div>}</article>)}</div>}</section>;
}
function Card({ label, value }: { label: string; value: number }) { return <div className="surface-soft rounded-xl p-3"><p className="text-xs text-subtle">{label}</p><p className="text-2xl font-bold text-main">{value}</p></div>; }
