import React, { useEffect, useMemo, useState } from 'react';
import { getBookingSettings, getStaffSchedule, hasDateClosureRuleConflictingWithExceptionalClosures, hasDuplicateClosureRuleScopes, isServiceCompatibleWithStaff, isValidBookingSettings, parseBookingDate } from '../../../lib/booking';
import { getBarberManagedCollection, getFirestoreWriteErrorMessage, updateBarberBookingSettings, updateBarberManagedRecord, updateBarberWorkingHours } from '../../../lib/barbers';
import { normalizeWorkingHours } from '../../../lib/public-business';
import type { Barber, BarberStaff, BookingSettings, ClosureRule, PublicBusiness, Service, WeeklySchedule } from '../../../lib/types';
import { notifyError, notifySuccess } from '../FloatingNotifications';

const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

type BookingBusiness = Pick<Barber | PublicBusiness, 'id' | 'config' | 'workingHours'>;
type ClosureDraft = { kind: 'weekly' | 'date'; weekday: string; date: string; allDays: boolean; fullDay: boolean; startTime: string; endTime: string; reason: string };
type ClosureEntry = { rules: ClosureRule[]; label: string; detail: string };

const emptyClosureDraft = (): ClosureDraft => ({ kind: 'weekly', weekday: '1', date: '', allDays: false, fullDay: true, startTime: '09:00', endTime: '10:00', reason: '' });
const ruleSignature = (rule: ClosureRule) => `${rule.startTime || ''}|${rule.endTime || ''}|${rule.reason || ''}`;
const formatClosureDetail = (rule: ClosureRule) => rule.startTime && rule.endTime ? `${rule.startTime}–${rule.endTime}` : 'Todo el día';

function breaksToText(schedule: WeeklySchedule, day: number) {
  return (schedule[day]?.breaks || []).map((item) => `${item.start}-${item.end}`).join(', ');
}

function parseBreaks(value: string, start: string, end: string) {
  if (!value.trim()) return [];
  const breaks = value.split(',').map((item) => item.trim().split('-').map((time) => time.trim()));
  if (breaks.some(([breakStart, breakEnd]) => !TIME.test(breakStart) || !TIME.test(breakEnd) || breakStart >= breakEnd || breakStart < start || breakEnd > end)) return null;
  return breaks.map(([breakStart, breakEnd]) => ({ start: breakStart, end: breakEnd }));
}

function closureEntries(rules: ClosureRule[]): ClosureEntry[] {
  const entries: ClosureEntry[] = [];
  const consumed = new Set<string>();
  const weeklyBySignature = new Map<string, Array<Extract<ClosureRule, { kind: 'weekly' }>>>();
  rules.filter((rule): rule is Extract<ClosureRule, { kind: 'weekly' }> => rule.kind === 'weekly').forEach((rule) => {
    const group = weeklyBySignature.get(ruleSignature(rule)) || [];
    group.push(rule);
    weeklyBySignature.set(ruleSignature(rule), group);
  });

  for (const group of weeklyBySignature.values()) {
    if (new Set(group.map((rule) => rule.weekday)).size !== 7) continue;
    group.forEach((rule) => consumed.add(rule.id));
    entries.push({ rules: group, label: 'Todos los días', detail: formatClosureDetail(group[0]) });
  }
  rules.forEach((rule) => {
    if (consumed.has(rule.id)) return;
    entries.push({ rules: [rule], label: rule.kind === 'weekly' ? DAYS[rule.weekday] : rule.date, detail: formatClosureDetail(rule) });
  });
  return entries.sort((left, right) => left.label.localeCompare(right.label, 'es'));
}

function createClosureId() {
  return `closure-${crypto.randomUUID()}`;
}

export default function BookingConfiguration({ business }: { business: BookingBusiness }) {
  const [settings, setSettingsState] = useState<BookingSettings>(() => getBookingSettings(business));
  const [workingHours, setWorkingHours] = useState(() => normalizeWorkingHours(business.workingHours));
  const [services, setServices] = useState<Service[]>([]);
  const [staff, setStaff] = useState<BarberStaff[]>([]);
  const [schedules, setSchedules] = useState<Record<string, WeeklySchedule>>({});
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [closureDraft, setClosureDraft] = useState<ClosureDraft>(emptyClosureDraft);
  const [editingClosureIds, setEditingClosureIds] = useState<string[]>([]);
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

  const closureRuleEntries = useMemo(() => closureEntries(settings.closureRules), [settings.closureRules]);
  const activeStaff = staff.filter((member) => member.active);
  const selectedSchedule = schedules[selectedStaffId];

  const persistSettings = async (nextSettings: BookingSettings, successMessage: string): Promise<boolean> => {
    setValidationMessage('');
    if (nextSettings.minimumNoticeMinutes < 0 || nextSettings.bookingHorizonDays < 1 || nextSettings.slotIntervalMinutes < 5 || nextSettings.slotIntervalMinutes > 120) { setValidationMessage('Revisa los límites de agendamiento y el intervalo de turnos.'); return false; }
    if (!isValidBookingSettings(nextSettings)) { setValidationMessage('Revisa los cierres antes de guardar: cada regla debe tener un identificador, fecha o día válidos, un intervalo único por alcance y, si es parcial, ambas horas en orden.'); return false; }
    try {
      setSaving(true);
      await updateBarberBookingSettings(business.id, nextSettings);
      setSettingsState(nextSettings);
      notifySuccess(successMessage);
      return true;
    } catch (error) { notifyError(getFirestoreWriteErrorMessage(error, 'No se pudo guardar la configuración de agendamiento.')); return false; } finally { setSaving(false); }
  };

  // Deletion controls predate the persisted closure editor. Keep them non-optimistic
  // so a failed write cannot make a closure appear removed until it is actually saved.
  const setSettings = (nextSettings: BookingSettings) => {
    if (nextSettings.closureRules.length < settings.closureRules.length) {
      void persistSettings(nextSettings, 'Cierre eliminado.');
      return;
    }
    setSettingsState(nextSettings);
  };

  const saveSettings = async () => { await persistSettings(settings, 'Configuración de agendamiento guardada.'); };

  const saveWorkingHours = async () => {
    setValidationMessage('');
    if (Object.values(workingHours).some((day) => day.enabled && (!TIME.test(day.open) || !TIME.test(day.close) || day.open >= day.close))) return setValidationMessage('En los días activos, la apertura debe ser anterior al cierre.');
    try {
      setSaving(true);
      await updateBarberWorkingHours(business.id, workingHours);
      notifySuccess('Horario de atención guardado.');
    } catch (error) { notifyError(getFirestoreWriteErrorMessage(error, 'No se pudo guardar el horario de atención.')); } finally { setSaving(false); }
  };

  const saveServiceStaff = async (service: Service, staffIds: string[]) => {
    setValidationMessage('');
    if (staffIds.length === 0) return setValidationMessage('Cada servicio debe tener al menos un profesional activo compatible.');
    setSaving(true);
    try {
      await updateBarberManagedRecord(business.id, 'services', service.id, { staffIds });
      setServices((items) => items.map((item) => item.id === service.id ? { ...item, staffIds } : item));
      notifySuccess('Compatibilidad de servicio guardada.');
    } catch (error) { notifyError(getFirestoreWriteErrorMessage(error, 'No se pudo guardar la compatibilidad.')); } finally { setSaving(false); }
  };

  const saveServiceBuffer = async (service: Service) => {
    const bufferMinutes = service.bufferMinutes || 0;
    setValidationMessage('');
    if (!Number.isInteger(bufferMinutes) || bufferMinutes < 0 || bufferMinutes > 240) return setValidationMessage('El buffer debe ser un número entero entre 0 y 240 minutos.');
    setSaving(true);
    try {
      await updateBarberManagedRecord(business.id, 'services', service.id, { bufferMinutes });
      notifySuccess('Buffer de servicio guardado.');
    } catch (error) { notifyError(getFirestoreWriteErrorMessage(error, 'No se pudo guardar el buffer.')); } finally { setSaving(false); }
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
      await updateBarberManagedRecord(business.id, 'barbers', selectedStaffId, { schedule });
      notifySuccess('Horario del profesional guardado.');
    } catch (error) { notifyError(getFirestoreWriteErrorMessage(error, 'No se pudo guardar el horario.')); } finally { setSaving(false); }
  };

  const resetClosureDraft = () => { setClosureDraft(emptyClosureDraft()); setEditingClosureIds([]); };
  const saveClosureDraft = async () => {
    setValidationMessage('');
    const weekday = Number(closureDraft.weekday);
    if ((closureDraft.kind === 'weekly' && (!Number.isInteger(weekday) || weekday < 0 || weekday > 6)) || (closureDraft.kind === 'date' && !parseBookingDate(closureDraft.date))) return setValidationMessage('Elige un día o una fecha válida para el cierre.');
    if (!closureDraft.fullDay && (!TIME.test(closureDraft.startTime) || !TIME.test(closureDraft.endTime) || closureDraft.startTime >= closureDraft.endTime)) return setValidationMessage('Un cierre parcial necesita ambas horas y la inicial debe ser anterior a la final.');
    if (closureDraft.reason.trim().length > 500) return setValidationMessage('El motivo administrativo puede tener hasta 500 caracteres.');

    const edited = settings.closureRules.filter((rule) => editingClosureIds.includes(rule.id));
    const targets = closureDraft.kind === 'weekly' && closureDraft.allDays ? [0, 1, 2, 3, 4, 5, 6] : [weekday];
    const existingByDay = new Map(edited.filter((rule): rule is Extract<ClosureRule, { kind: 'weekly' }> => rule.kind === 'weekly').map((rule) => [rule.weekday, rule]));
    const nextRules = targets.map((target) => {
      const current = closureDraft.kind === 'weekly' ? existingByDay.get(target) : edited[0];
      const common = { id: current?.id || createClosureId(), ...(closureDraft.fullDay ? {} : { startTime: closureDraft.startTime, endTime: closureDraft.endTime }), ...(closureDraft.reason.trim() ? { reason: closureDraft.reason.trim() } : {}) };
      return closureDraft.kind === 'weekly' ? { ...common, kind: 'weekly' as const, weekday: target } : { ...common, kind: 'date' as const, date: closureDraft.date };
    });
    const remaining = settings.closureRules.filter((rule) => !editingClosureIds.includes(rule.id));
    if (remaining.length + nextRules.length > 100) return setValidationMessage('Puede guardar como máximo 100 reglas de cierre.');
    if (hasDateClosureRuleConflictingWithExceptionalClosures(nextRules, settings.exceptionalClosures)) {
      return setValidationMessage('Esta fecha ya tiene un cierre completo heredado. Elimina ese cierre antes de agregar una regla por fecha.');
    }
    if (hasDuplicateClosureRuleScopes([...remaining, ...nextRules])) {
      if (closureDraft.kind === 'weekly' && closureDraft.allDays) return setValidationMessage('Esta política incluye al menos un cierre semanal que ya existe con este mismo intervalo. Edita la regla existente o cambia el intervalo.');
      if (closureDraft.kind === 'weekly') return setValidationMessage(`Ya existe un cierre semanal para ${DAYS[weekday]} con este mismo intervalo. Edita la regla existente o cambia el intervalo.`);
      return setValidationMessage('Ya existe un cierre para esta fecha con este mismo intervalo. Edita la regla existente o cambia el intervalo.');
    }
    const nextSettings = { ...settings, closureRules: [...remaining, ...nextRules] };
    if (await persistSettings(nextSettings, editingClosureIds.length ? 'Cierre actualizado.' : 'Cierre guardado.')) resetClosureDraft();
  };

  const editClosure = (entry: ClosureEntry) => {
    const first = entry.rules[0];
    setEditingClosureIds(entry.rules.map((rule) => rule.id));
    setClosureDraft({ kind: first.kind, weekday: first.kind === 'weekly' ? String(first.weekday) : '1', date: first.kind === 'date' ? first.date : '', allDays: entry.rules.length === 7, fullDay: !first.startTime, startTime: first.startTime || '09:00', endTime: first.endTime || '10:00', reason: first.reason || '' });
  };

  return <section className="business-admin-panel space-y-8">
    <div><h3 className="text-lg font-bold text-main">Configuración de agendamiento</h3><p className="mt-1 text-sm text-subtle">Controla la disponibilidad general, los cierres y la operación del equipo.</p></div>
    {validationMessage && <p className="error-message rounded-lg p-3 text-sm" role="alert">{validationMessage}</p>}

    <section aria-labelledby="business-hours-title"><h4 id="business-hours-title" className="font-semibold text-main">Horario de atención</h4><p className="mt-1 text-sm text-subtle">Define cuándo atiende el negocio. El horario personal puede reducir esta disponibilidad, pero no ampliarla.</p><div className="mt-3 space-y-2">{DAYS.map((day, index) => { const current = workingHours[index]; return <div key={day} className="surface-soft grid items-center gap-2 rounded-lg p-3 sm:grid-cols-[minmax(9rem,1fr)_minmax(7rem,auto)_minmax(7rem,auto)]"><label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={current.enabled} onChange={(event) => setWorkingHours({ ...workingHours, [index]: { ...current, enabled: event.target.checked } })} />{day}</label><label className="text-sm">Abre<input aria-label={`${day}: hora de apertura`} type="time" disabled={!current.enabled} className="field-input mt-1" value={current.open} onChange={(event) => setWorkingHours({ ...workingHours, [index]: { ...current, open: event.target.value } })} /></label><label className="text-sm">Cierra<input aria-label={`${day}: hora de cierre`} type="time" disabled={!current.enabled} className="field-input mt-1" value={current.close} onChange={(event) => setWorkingHours({ ...workingHours, [index]: { ...current, close: event.target.value } })} /></label></div>; })}</div><button type="button" className="btn-primary mt-3 rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50" disabled={saving} onClick={() => void saveWorkingHours()}>{saving ? 'Guardando...' : 'Guardar horario de atención'}</button></section>

    <section aria-labelledby="booking-limits-title"><h4 id="booking-limits-title" className="font-semibold text-main">Límites de agendamiento</h4><div className="mt-3 grid gap-3 md:grid-cols-3"><label className="field-label">Anticipación mínima (minutos)<input type="number" min="0" className="field-input mt-1" value={settings.minimumNoticeMinutes} onChange={(event) => setSettings({ ...settings, minimumNoticeMinutes: Number(event.target.value) })} /></label><label className="field-label">Horizonte (días)<input type="number" min="1" className="field-input mt-1" value={settings.bookingHorizonDays} onChange={(event) => setSettings({ ...settings, bookingHorizonDays: Number(event.target.value) })} /></label><label className="field-label">Intervalo (minutos)<input type="number" min="5" max="120" className="field-input mt-1" value={settings.slotIntervalMinutes} onChange={(event) => setSettings({ ...settings, slotIntervalMinutes: Number(event.target.value) })} /></label></div><button type="button" className="btn-primary mt-3 rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50" disabled={saving} onClick={() => void saveSettings()}>{saving ? 'Guardando...' : 'Guardar configuración'}</button></section>

    <section aria-labelledby="customer-fields-title"><h4 id="customer-fields-title" className="font-semibold text-main">Datos solicitados al agendar</h4><p className="mt-1 text-sm text-subtle">Nombre y celular siempre son obligatorios. Puedes decidir si pides correo y dirección; al solicitar alguno, la persona debe aceptar los documentos de privacidad.</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="field-label">Correo electrónico<select className="field-input mt-1" value={settings.customerFields.email} onChange={(event) => setSettings({ ...settings, customerFields: { ...settings.customerFields, email: event.target.value as BookingSettings['customerFields']['email'] } })}><option value="disabled">No solicitar</option><option value="optional">Opcional</option><option value="required">Obligatorio</option></select></label><label className="field-label">Dirección<select className="field-input mt-1" value={settings.customerFields.address} onChange={(event) => setSettings({ ...settings, customerFields: { ...settings.customerFields, address: event.target.value as BookingSettings['customerFields']['address'] } })}><option value="disabled">No solicitar</option><option value="optional">Opcional</option><option value="required">Obligatorio</option></select></label></div><button type="button" className="btn-primary mt-3 rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50" disabled={saving} onClick={() => void saveSettings()}>{saving ? 'Guardando...' : 'Guardar datos solicitados'}</button></section>
    <section aria-labelledby="product-selection-title"><h4 id="product-selection-title" className="font-semibold text-main">Productos al agendar</h4><p className="mt-1 text-sm text-subtle">Activa esta opción para que las personas puedan indicar productos de tu catálogo público junto con la solicitud. No reserva inventario ni precio.</p><label className="mt-3 flex items-start gap-3 text-sm text-main"><input className="mt-1 h-4 w-4" type="checkbox" checked={settings.productSelectionEnabled} onChange={(event) => setSettings({ ...settings, productSelectionEnabled: event.target.checked })} /><span><strong className="block">Permitir selección de productos</strong><span className="text-subtle">Solo se muestra si hay productos activos publicados.</span></span></label><button type="button" className="btn-primary mt-3 rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50" disabled={saving} onClick={() => void saveSettings()}>{saving ? 'Guardando...' : 'Guardar productos al agendar'}</button></section>

    <section aria-labelledby="closures-title"><div><h4 id="closures-title" className="font-semibold text-main">Cierres</h4><p className="mt-1 text-sm text-subtle">Agrega cierres semanales o para una fecha específica. Los cierres de todo el día no necesitan horas.</p></div><fieldset className="surface-soft mt-3 grid gap-3 rounded-xl p-4"><legend className="sr-only">Editor de cierres</legend><div className="grid gap-3 sm:grid-cols-2"><label className="field-label">Se repite<select className="field-input mt-1" value={closureDraft.kind} onChange={(event) => setClosureDraft({ ...closureDraft, kind: event.target.value as ClosureDraft['kind'], allDays: false })}><option value="weekly">Cada semana</option><option value="date">En una fecha</option></select></label>{closureDraft.kind === 'weekly' ? <label className="field-label">Día<select className="field-input mt-1" disabled={closureDraft.allDays} value={closureDraft.weekday} onChange={(event) => setClosureDraft({ ...closureDraft, weekday: event.target.value })}>{DAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label> : <label className="field-label">Fecha<input className="field-input mt-1" type="date" value={closureDraft.date} onChange={(event) => setClosureDraft({ ...closureDraft, date: event.target.value })} /></label>}</div>{closureDraft.kind === 'weekly' && <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={closureDraft.allDays} onChange={(event) => setClosureDraft({ ...closureDraft, allDays: event.target.checked })} />Todos los días</label>}<label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={closureDraft.fullDay} onChange={(event) => setClosureDraft({ ...closureDraft, fullDay: event.target.checked })} />Todo el día</label>{!closureDraft.fullDay && <div className="grid gap-3 sm:grid-cols-2"><label className="field-label">Desde<input className="field-input mt-1" type="time" value={closureDraft.startTime} onChange={(event) => setClosureDraft({ ...closureDraft, startTime: event.target.value })} /></label><label className="field-label">Hasta<input className="field-input mt-1" type="time" value={closureDraft.endTime} onChange={(event) => setClosureDraft({ ...closureDraft, endTime: event.target.value })} /></label></div>}<label className="field-label">Motivo administrativo <span className="font-normal text-subtle">(opcional)</span><input className="field-input mt-1" maxLength={500} value={closureDraft.reason} onChange={(event) => setClosureDraft({ ...closureDraft, reason: event.target.value })} /></label><div className="flex flex-wrap gap-2"><button type="button" className="btn-outline rounded-lg px-3 py-2 text-sm" onClick={saveClosureDraft}>{editingClosureIds.length ? 'Guardar cierre' : 'Agregar cierre'}</button>{editingClosureIds.length > 0 && <button type="button" className="btn-outline rounded-lg px-3 py-2 text-sm" onClick={resetClosureDraft}>Cancelar edición</button>}</div></fieldset><div className="mt-3 space-y-2" aria-live="polite">{closureRuleEntries.length === 0 && <p className="text-sm text-subtle">Aún no hay cierres configurados.</p>}{closureRuleEntries.map((entry) => <div key={entry.rules.map((rule) => rule.id).join('-')} className="surface-soft flex flex-wrap items-center justify-between gap-3 rounded-lg p-3"><div className="min-w-0 text-sm"><p className="font-semibold text-main">{entry.label} · {entry.detail}</p>{entry.rules[0].reason && <p className="mt-1 break-words text-subtle">{entry.rules[0].reason}</p>}</div><div className="flex gap-3 text-sm"><button type="button" className="underline" onClick={() => editClosure(entry)}>Editar</button><button type="button" className="danger-action rounded px-2 py-1" onClick={() => { setSettings({ ...settings, closureRules: settings.closureRules.filter((rule) => !entry.rules.some((current) => current.id === rule.id)) }); if (entry.rules.some((rule) => editingClosureIds.includes(rule.id))) resetClosureDraft(); }}>Eliminar</button></div></div>)}</div>{settings.exceptionalClosures.length > 0 && <div className="mt-4 border-t border-(--border) pt-4"><p className="font-semibold text-main">Cierres anteriores</p><p className="mt-1 text-sm text-subtle">Se conservan como cierres de todo el día.</p><div className="mt-2 space-y-1 text-sm">{settings.exceptionalClosures.map((closure) => <p key={closure.date}>{closure.date} · Todo el día{closure.reason ? ` · ${closure.reason}` : ''}</p>)}</div></div>}</section>

    <section aria-labelledby="service-staff-title"><h4 id="service-staff-title" className="font-semibold text-main">Servicios y profesionales compatibles</h4><p className="mt-1 text-sm text-subtle">Los servicios heredados sin configuración siguen siendo compatibles con todo el personal activo hasta que se guarden aquí.</p><div className="mt-3 space-y-3">{services.map((service) => { const selected = activeStaff.filter((member) => isServiceCompatibleWithStaff(service, member.id)).map((member) => member.id); return <div key={service.id} className="surface-soft rounded-xl p-4"><div className="flex flex-wrap items-end justify-between gap-2"><p className="font-medium text-main">{service.name}</p><label className="text-sm">Buffer (minutos)<input type="number" min="0" max="240" className="field-input mt-1 w-28" value={service.bufferMinutes || 0} onChange={(event) => setServices((items) => items.map((item) => item.id === service.id ? { ...item, bufferMinutes: Number(event.target.value) } : item))} onBlur={() => void saveServiceBuffer(service)} /></label></div><div className="mt-2 flex flex-wrap gap-3">{activeStaff.map((member) => <label key={member.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.includes(member.id)} onChange={(event) => void saveServiceStaff(service, event.target.checked ? [...selected, member.id] : selected.filter((id) => id !== member.id))} />{member.name}</label>)}</div>{activeStaff.length === 0 && <p className="mt-2 text-sm text-subtle">No hay profesionales activos.</p>}</div>; })}</div></section>
    <section aria-labelledby="staff-schedule-title"><h4 id="staff-schedule-title" className="font-semibold text-main">Horario y descansos del profesional</h4>{staff.length === 0 ? <p className="mt-2 text-sm text-subtle">Agrega un profesional para configurar su horario.</p> : <><select className="field-input mt-3 max-w-sm" aria-label="Profesional" value={selectedStaffId} onChange={(event) => setSelectedStaffId(event.target.value)}>{staff.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select>{selectedSchedule && <div className="mt-3 space-y-2">{DAYS.map((day, index) => { const current = selectedSchedule[index]; return <div key={day} className="surface-soft grid gap-2 rounded-lg p-3 md:grid-cols-[1fr_auto_auto_2fr]"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={current.enabled} onChange={(event) => setSchedules({ ...schedules, [selectedStaffId]: { ...selectedSchedule, [index]: { ...current, enabled: event.target.checked } } })} />{day}</label><input type="time" disabled={!current.enabled} className="field-input" value={current.start} onChange={(event) => setSchedules({ ...schedules, [selectedStaffId]: { ...selectedSchedule, [index]: { ...current, start: event.target.value } } })} /><input type="time" disabled={!current.enabled} className="field-input" value={current.end} onChange={(event) => setSchedules({ ...schedules, [selectedStaffId]: { ...selectedSchedule, [index]: { ...current, end: event.target.value } } })} /><input disabled={!current.enabled} className="field-input" value={breaksToText(selectedSchedule, index)} placeholder="Descansos: 13:00-14:00" onChange={(event) => { const breaks = parseBreaks(event.target.value, current.start, current.end); if (breaks) setSchedules({ ...schedules, [selectedStaffId]: { ...selectedSchedule, [index]: { ...current, breaks } } }); }} /></div>; })}</div>}<button type="button" className="btn-primary mt-3 rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50" disabled={saving} onClick={() => void saveSchedule()}>{saving ? 'Guardando...' : 'Guardar horario'}</button></>}</section>
  </section>;
}
