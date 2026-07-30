import React, { useEffect, useState } from 'react';
import { getBookingSettings, getStaffSchedule, isServiceCompatibleWithStaff } from '../../../lib/booking';
import { getBarberManagedCollection, updateBarberBookingSettings, updateBarberManagedRecord } from '../../../lib/barbers';
import type { Barber, BarberStaff, BookingSettings, PublicBusiness, Service, WeeklySchedule } from '../../../lib/types';
import { notifyError, notifySuccess } from '../FloatingNotifications';

const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function breaksToText(schedule: WeeklySchedule, day: number) {
  return (schedule[day]?.breaks || []).map((item) => `${item.start}-${item.end}`).join(', ');
}

function parseBreaks(value: string, start: string, end: string) {
  if (!value.trim()) return [];
  const breaks = value.split(',').map((item) => item.trim().split('-').map((time) => time.trim()));
  if (breaks.some(([breakStart, breakEnd]) => !TIME.test(breakStart) || !TIME.test(breakEnd) || breakStart >= breakEnd || breakStart < start || breakEnd > end)) return null;
  return breaks.map(([breakStart, breakEnd]) => ({ start: breakStart, end: breakEnd }));
}

type BookingBusiness = Pick<Barber | PublicBusiness, 'id' | 'config' | 'workingHours'>;

export default function BookingConfiguration({ business }: { business: BookingBusiness }) {
  const [settings, setSettings] = useState<BookingSettings>(() => getBookingSettings(business));
  const [services, setServices] = useState<Service[]>([]);
  const [staff, setStaff] = useState<BarberStaff[]>([]);
  const [schedules, setSchedules] = useState<Record<string, WeeklySchedule>>({});
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [closureDate, setClosureDate] = useState('');
  const [closureReason, setClosureReason] = useState('');
  const [validationMessage, setValidationMessage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([getBarberManagedCollection<Service>(business.id, 'services'), getBarberManagedCollection<BarberStaff>(business.id, 'barbers')]).then(([nextServices, nextStaff]) => {
      setServices(nextServices);
      setStaff(nextStaff);
      setSchedules(Object.fromEntries(nextStaff.map((member) => [member.id, getStaffSchedule(member, business.workingHours)])));
      setSelectedStaffId(nextStaff[0]?.id || '');
    });
  }, [business.id, business.workingHours]);

  const saveSettings = async () => {
    setValidationMessage('');
    if (settings.minimumNoticeMinutes < 0 || settings.bookingHorizonDays < 1 || settings.slotIntervalMinutes < 5 || settings.slotIntervalMinutes > 120) {
      setValidationMessage('Revisa los límites de reserva y el intervalo de turnos.');
      return;
    }
    try {
      setSaving(true);
      if (!await updateBarberBookingSettings(business.id, settings)) throw new Error('No se pudo guardar la configuración de reservas.');
      notifySuccess('Configuración de reservas guardada.');
    } catch (error) { notifyError(error instanceof Error ? error.message : 'No se pudo guardar la configuración de reservas.'); } finally { setSaving(false); }
  };

  const saveServiceStaff = async (service: Service, staffIds: string[]) => {
    setValidationMessage('');
    if (staffIds.length === 0) return setValidationMessage('Cada servicio debe tener al menos un profesional activo compatible.');
    setSaving(true);
    try {
      if (!await updateBarberManagedRecord(business.id, 'services', service.id, { staffIds })) throw new Error('No se pudo guardar la compatibilidad.');
      setServices((items) => items.map((item) => item.id === service.id ? { ...item, staffIds } : item));
      notifySuccess('Compatibilidad de servicio guardada.');
    } catch (error) { notifyError(error instanceof Error ? error.message : 'No se pudo guardar la compatibilidad.'); } finally { setSaving(false); }
  };

  const saveServiceBuffer = async (service: Service) => {
    const bufferMinutes = service.bufferMinutes || 0;
    setValidationMessage('');
    if (!Number.isInteger(bufferMinutes) || bufferMinutes < 0 || bufferMinutes > 240) return setValidationMessage('El buffer debe ser un número entero entre 0 y 240 minutos.');
    setSaving(true);
    try {
      if (!await updateBarberManagedRecord(business.id, 'services', service.id, { bufferMinutes })) throw new Error('No se pudo guardar el buffer.');
      notifySuccess('Buffer de servicio guardado.');
    } catch (error) { notifyError(error instanceof Error ? error.message : 'No se pudo guardar el buffer.'); } finally { setSaving(false); }
  };

  const saveSchedule = async () => {
    const schedule = schedules[selectedStaffId];
    setValidationMessage('');
    if (!schedule) return;
    for (const day of Object.values(schedule)) {
      if (!day.enabled) continue;
      if (!TIME.test(day.start) || !TIME.test(day.end) || day.start >= day.end || day.breaks.some((item) => item.start < day.start || item.end > day.end || item.start >= item.end)) return setValidationMessage('Revisa los horarios y descansos del profesional seleccionado.');
    }
    setSaving(true);
    try {
      if (!await updateBarberManagedRecord(business.id, 'barbers', selectedStaffId, { schedule })) throw new Error('No se pudo guardar el horario.');
      notifySuccess('Horario del profesional guardado.');
    } catch (error) { notifyError(error instanceof Error ? error.message : 'No se pudo guardar el horario.'); } finally { setSaving(false); }
  };

  const activeStaff = staff.filter((member) => member.active);
  const selectedSchedule = schedules[selectedStaffId];

  return <section className="business-admin-panel space-y-8">
    <div><h3 className="text-lg font-bold text-main">Configuración de reservas</h3><p className="mt-1 text-sm text-subtle">Estos datos preparan la disponibilidad. Todavía no habilitan reservas públicas.</p></div>
    {validationMessage && <p className="error-message rounded-lg p-3 text-sm" role="alert">{validationMessage}</p>}
    <div className="grid gap-3 md:grid-cols-3"><label className="field-label">Anticipación mínima (minutos)<input type="number" min="0" className="field-input mt-1" value={settings.minimumNoticeMinutes} onChange={(event) => setSettings({ ...settings, minimumNoticeMinutes: Number(event.target.value) })} /></label><label className="field-label">Horizonte (días)<input type="number" min="1" className="field-input mt-1" value={settings.bookingHorizonDays} onChange={(event) => setSettings({ ...settings, bookingHorizonDays: Number(event.target.value) })} /></label><label className="field-label">Intervalo (minutos)<input type="number" min="5" max="120" className="field-input mt-1" value={settings.slotIntervalMinutes} onChange={(event) => setSettings({ ...settings, slotIntervalMinutes: Number(event.target.value) })} /></label></div>
    <button type="button" className="btn-primary rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50" disabled={saving} onClick={saveSettings}>Guardar configuración</button>
    <div><h4 className="font-semibold text-main">Cierres excepcionales</h4><div className="mt-2 flex flex-wrap gap-2"><input type="date" className="field-input" value={closureDate} onChange={(event) => setClosureDate(event.target.value)} /><input className="field-input" value={closureReason} placeholder="Motivo opcional" onChange={(event) => setClosureReason(event.target.value)} /><button type="button" className="btn-outline rounded-lg px-3 py-2 text-sm" onClick={() => { if (!closureDate || settings.exceptionalClosures.some((closure) => closure.date === closureDate)) return setValidationMessage('Elige una fecha de cierre que no esté repetida.'); setValidationMessage(''); setSettings({ ...settings, exceptionalClosures: [...settings.exceptionalClosures, { date: closureDate, reason: closureReason.trim() || undefined }] }); setClosureDate(''); setClosureReason(''); }}>Agregar cierre</button></div><div className="mt-2 space-y-1 text-sm">{settings.exceptionalClosures.map((closure) => <p key={closure.date}>{closure.date}{closure.reason ? `: ${closure.reason}` : ''} <button type="button" className="underline" onClick={() => setSettings({ ...settings, exceptionalClosures: settings.exceptionalClosures.filter((item) => item.date !== closure.date) })}>Quitar</button></p>)}</div></div>
    <div><h4 className="font-semibold text-main">Servicios y profesionales compatibles</h4><p className="mt-1 text-sm text-subtle">Los servicios heredados sin configuración siguen siendo compatibles con todo el personal activo hasta que se guarden aquí.</p><div className="mt-3 space-y-3">{services.map((service) => { const selected = activeStaff.filter((member) => isServiceCompatibleWithStaff(service, member.id)).map((member) => member.id); return <div key={service.id} className="surface-soft rounded-xl p-4"><div className="flex flex-wrap items-end justify-between gap-2"><p className="font-medium text-main">{service.name}</p><label className="text-sm">Buffer (minutos)<input type="number" min="0" max="240" className="field-input mt-1 w-28" value={service.bufferMinutes || 0} onChange={(event) => setServices((items) => items.map((item) => item.id === service.id ? { ...item, bufferMinutes: Number(event.target.value) } : item))} onBlur={() => saveServiceBuffer(service)} /></label></div><div className="mt-2 flex flex-wrap gap-3">{activeStaff.map((member) => <label key={member.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.includes(member.id)} onChange={(event) => saveServiceStaff(service, event.target.checked ? [...selected, member.id] : selected.filter((id) => id !== member.id))} />{member.name}</label>)}</div>{activeStaff.length === 0 && <p className="mt-2 text-sm text-subtle">No hay profesionales activos.</p>}</div>; })}</div></div>
    <div><h4 className="font-semibold text-main">Horario y descansos del profesional</h4>{staff.length === 0 ? <p className="mt-2 text-sm text-subtle">Agregá un profesional para configurar su horario.</p> : <><select className="field-input mt-3 max-w-sm" value={selectedStaffId} onChange={(event) => setSelectedStaffId(event.target.value)}>{staff.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select>{selectedSchedule && <div className="mt-3 space-y-2">{DAYS.map((day, index) => { const current = selectedSchedule[index]; return <div key={day} className="surface-soft grid gap-2 rounded-lg p-3 md:grid-cols-[1fr_auto_auto_2fr]"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={current.enabled} onChange={(event) => setSchedules({ ...schedules, [selectedStaffId]: { ...selectedSchedule, [index]: { ...current, enabled: event.target.checked } } })} />{day}</label><input type="time" disabled={!current.enabled} className="field-input" value={current.start} onChange={(event) => setSchedules({ ...schedules, [selectedStaffId]: { ...selectedSchedule, [index]: { ...current, start: event.target.value } } })} /><input type="time" disabled={!current.enabled} className="field-input" value={current.end} onChange={(event) => setSchedules({ ...schedules, [selectedStaffId]: { ...selectedSchedule, [index]: { ...current, end: event.target.value } } })} /><input disabled={!current.enabled} className="field-input" value={breaksToText(selectedSchedule, index)} placeholder="Descansos: 13:00-14:00" onChange={(event) => { const breaks = parseBreaks(event.target.value, current.start, current.end); if (breaks) setSchedules({ ...schedules, [selectedStaffId]: { ...selectedSchedule, [index]: { ...current, breaks } } }); }} /></div>; })}</div>}<button type="button" className="btn-primary mt-3 rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50" disabled={saving} onClick={saveSchedule}>Guardar horario</button></>}</div>
  </section>;
}
