import React, { useEffect, useMemo, useState } from 'react';
import {
  checkBookingAvailability,
  getBookingDate,
  getBookingLockIntervals,
  getBookingSettings,
  getStaffSchedule,
  hasBookingLockConflict,
  isServiceCompatibleWithStaff,
  minutesToTime,
  timeToMinutes,
} from '../../../lib/booking';
import { createClientBooking, type PublicBookingConfiguration } from '../../../lib/booking-transaction';
import { loadPublicBookingConfiguration, loadPublicDateLocks } from '../../../lib/public-booking';
import type { BarberStaff, PublicBusiness, Service } from '../../../lib/types';

type StaffChoice = 'any' | string;
type AvailableSlot = { time: string; staffId: string };

const COLOMBIAN_PHONE = /^(?:\+?57)?3\d{9}$/;

function formatDate(date: string) {
  return new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'full' }).format(new Date(`${date}T12:00:00Z`));
}

function formatDuration(minutes: number) {
  return `${minutes} min`;
}

export default function PublicBookingWidget({ business, whatsappUrl }: { business: PublicBusiness; whatsappUrl: string | null }) {
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [services, setServices] = useState<Service[]>([]);
  const [staff, setStaff] = useState<BarberStaff[]>([]);
  const [serviceId, setServiceId] = useState('');
  const [bookingDate, setBookingDate] = useState('');
  const [staffChoice, setStaffChoice] = useState<StaffChoice>('any');
  const [slot, setSlot] = useState<AvailableSlot | null>(null);
  const [locks, setLocks] = useState<Map<string, Set<string>>>(new Map());
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotError, setSlotError] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [step, setStep] = useState(1);
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmedStaff, setConfirmedStaff] = useState<BarberStaff | null>(null);

  const settings = useMemo(() => getBookingSettings(business), [business]);
  const today = getBookingDate(new Date());
  const maximumDate = useMemo(() => {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + settings.bookingHorizonDays);
    return date.toISOString().slice(0, 10);
  }, [settings.bookingHorizonDays, today]);
  const selectedService = services.find((service) => service.id === serviceId) || null;
  const compatibleStaff = useMemo(() => selectedService
    ? staff.filter((member) => isServiceCompatibleWithStaff(selectedService, member.id))
    : [], [selectedService, staff]);
  const selectedStaff = staffChoice === 'any' ? null : compatibleStaff.find((member) => member.id === staffChoice) || null;

  const loadConfiguration = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const configuration = await loadPublicBookingConfiguration(business.id);
      setServices(configuration.services);
      setStaff(configuration.staff);
      setLoaded(true);
    } catch (error) {
      console.error(error);
      setLoadError('No pudimos cargar los servicios disponibles. Inténtalo nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (loaded || loading) return;
    void loadConfiguration();
  // The widget owns this cache for its open lifetime; it deliberately does not refresh configuration.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const staffForSlots = staffChoice === 'any' ? compatibleStaff : selectedStaff ? [selectedStaff] : [];

  useEffect(() => {
    let cancelled = false;
    if (!selectedService || !bookingDate || staffForSlots.length === 0) {
      setLoadingSlots(false);
      setSlotError('');
      return undefined;
    }

    const missingStaff = staffForSlots.filter((member) => !locks.has(member.id));
    if (missingStaff.length === 0) return undefined;
    setLoadingSlots(true);
    setSlotError('');
    Promise.all(missingStaff.map(async (member) => [member.id, await loadPublicDateLocks(business.id, bookingDate, member.id)] as const))
      .then((entries) => {
        if (cancelled) return;
        setLocks((current) => {
          const next = new Map(current);
          entries.forEach(([staffId, occupied]) => next.set(staffId, occupied));
          return next;
        });
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) setSlotError('No pudimos consultar los horarios. Inténtalo nuevamente.');
      })
      .finally(() => { if (!cancelled) setLoadingSlots(false); });
    return () => { cancelled = true; };
  }, [business.id, bookingDate, locks, selectedService, staffForSlots]);

  const slots = useMemo((): AvailableSlot[] => {
    if (!selectedService || !bookingDate) return [];
    const byTime = new Map<string, AvailableSlot>();
    for (const member of staffForSlots) {
      const schedule = getStaffSchedule(member, business.workingHours);
      const interval = settings.slotIntervalMinutes;
      if (!Number.isInteger(interval) || interval <= 0) continue;
      const weekday = new Date(`${bookingDate}T12:00:00Z`).getUTCDay();
      const day = schedule[weekday] || { enabled: false, start: '00:00', end: '00:00', breaks: [] };
      const start = timeToMinutes(day.start);
      const end = timeToMinutes(day.end);
      if (!day.enabled || start === null || end === null) continue;
      for (let minute = start; minute < end; minute += interval) {
        const time = minutesToTime(minute);
        if (!time) continue;
        const availability = checkBookingAvailability({ business, service: selectedService, staff: member, staffId: member.id, bookingDate, startTime: time });
        const required = getBookingLockIntervals(time, selectedService.duration, selectedService.bufferMinutes || 0, interval);
        const occupied = locks.get(member.id);
        if (!availability.available || !required || !occupied || hasBookingLockConflict(required.map((item) => item.id), occupied)) continue;
        if (!byTime.has(time)) byTime.set(time, { time, staffId: member.id });
      }
    }
    return [...byTime.values()].sort((a, b) => a.time.localeCompare(b.time));
  }, [bookingDate, business, locks, selectedService, settings.slotIntervalMinutes, staffForSlots]);

  const resetAfterService = (nextServiceId: string) => {
    setServiceId(nextServiceId);
    setBookingDate('');
    setStaffChoice('any');
    setSlot(null);
    setLocks(new Map());
    setStep(2);
  };

  const resetAfterDate = (nextDate: string) => {
    setBookingDate(nextDate);
    setStaffChoice('any');
    setSlot(null);
    setLocks(new Map());
    setStep(3);
  };

  const resetAfterStaff = (nextStaff: StaffChoice) => {
    setStaffChoice(nextStaff);
    setSlot(null);
    setLocks(new Map());
    setStep(4);
  };

  const invalidateDate = () => setLocks(new Map());

  const submit = async () => {
    if (!selectedService || !bookingDate || !slot || !consent || !clientName.trim() || !COLOMBIAN_PHONE.test(clientPhone.replace(/[\s()-]/g, ''))) return;
    const staffMember = staff.find((member) => member.id === slot.staffId);
    if (!staffMember) return;
    setSubmitting(true);
    setSubmitError('');
    const configuration: PublicBookingConfiguration = { business, service: selectedService, staff: staffMember };
    const result = await createClientBooking({
      businessId: business.id,
      bookingDate,
      startTime: slot.time,
      clientName,
      clientPhone: clientPhone.replace(/[\s()-]/g, ''),
    }, configuration);
    setSubmitting(false);
    if (result.ok === true) {
      invalidateDate();
      setConfirmedStaff(staffMember);
      setStep(6);
      return;
    }
    invalidateDate();
    setSlot(null);
    setSubmitError(result.message);
    setStep(4);
  };

  const phoneValid = COLOMBIAN_PHONE.test(clientPhone.replace(/[\s()-]/g, ''));
  const canReview = Boolean(slot && clientName.trim() && phoneValid && consent);

  if (step === 6 && selectedService && bookingDate && slot) {
    return <div className="space-y-4" role="status" aria-live="polite">
      <h2 className="text-xl font-semibold text-main">Solicitud de reserva recibida</h2>
      <p className="text-subtle">Tu reserva está pendiente de confirmación.</p>
      <dl className="surface-soft grid gap-2 rounded-xl p-4 text-sm sm:grid-cols-2">
        <div><dt className="text-subtle">Servicio</dt><dd className="font-semibold text-main">{selectedService.name}</dd></div>
        <div><dt className="text-subtle">Fecha y hora</dt><dd className="font-semibold text-main">{formatDate(bookingDate)} · {slot.time}</dd></div>
        <div><dt className="text-subtle">Profesional</dt><dd className="font-semibold text-main">{confirmedStaff?.name}</dd></div>
        <div><dt className="text-subtle">Estado</dt><dd className="font-semibold text-main">Pendiente</dd></div>
      </dl>
    </div>;
  }

  return <div className="space-y-6" aria-busy={loading || loadingSlots || submitting}>
    <div>
      <h2 className="text-xl font-semibold text-main">Reserva tu cita</h2>
      <p className="mt-1 text-sm text-subtle">Elige el servicio y una hora disponible. Todos los horarios están en hora de Colombia.</p>
    </div>
    {loadError && <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-main" role="alert">{loadError}</p>}
    {loading && <p className="text-subtle" role="status">Cargando servicios disponibles...</p>}
    {!loading && !loadError && <>
      <ol className="grid grid-cols-5 gap-1 text-center text-xs text-subtle" aria-label="Progreso de la reserva">
        {['Servicio', 'Fecha', 'Profesional', 'Hora', 'Datos'].map((label, index) => <li key={label} aria-current={step === index + 1 ? 'step' : undefined} className={step >= index + 1 ? 'font-semibold text-main' : ''}>{index + 1}. {label}</li>)}
      </ol>
      <fieldset className="space-y-3">
        <legend className="font-semibold text-main">1. Elige un servicio</legend>
        {services.length === 0 ? <p className="text-sm text-subtle">Este negocio no tiene servicios disponibles para reservar.</p> : <div className="grid gap-2 sm:grid-cols-2">
          {services.map((service) => <button key={service.id} type="button" onClick={() => resetAfterService(service.id)} aria-pressed={service.id === serviceId} className={`rounded-xl border p-3 text-left ${service.id === serviceId ? 'border-[var(--secondary)] bg-[color-mix(in_srgb,var(--secondary)_12%,var(--surface))]' : 'border-[var(--border)]'}`}>
            <span className="block font-semibold text-main">{service.name}</span><span className="text-sm text-subtle">{formatDuration(service.duration)}</span>
          </button>)}
        </div>}
      </fieldset>
      {selectedService && <fieldset className="space-y-2">
        <legend className="font-semibold text-main">2. Elige una fecha</legend>
        <label className="field-label max-w-sm">Fecha disponible<input className="field-input mt-1" type="date" min={today} max={maximumDate} value={bookingDate} onChange={(event) => resetAfterDate(event.target.value)} /></label>
        <p className="text-xs text-subtle">Puedes reservar desde hoy hasta {maximumDate}, según la anticipación mínima del negocio.</p>
      </fieldset>}
      {selectedService && bookingDate && <fieldset className="space-y-3">
        <legend className="font-semibold text-main">3. Elige un profesional</legend>
        <div className="grid gap-2 sm:grid-cols-2"><button type="button" onClick={() => resetAfterStaff('any')} aria-pressed={staffChoice === 'any'} className={`rounded-xl border p-3 text-left ${staffChoice === 'any' ? 'border-[var(--secondary)] bg-[color-mix(in_srgb,var(--secondary)_12%,var(--surface))]' : 'border-[var(--border)]'}`}><span className="font-semibold text-main">Cualquier profesional disponible</span><span className="block text-sm text-subtle">Asignaremos uno con ese horario libre.</span></button>{compatibleStaff.map((member) => <button key={member.id} type="button" onClick={() => resetAfterStaff(member.id)} aria-pressed={staffChoice === member.id} className={`rounded-xl border p-3 text-left ${staffChoice === member.id ? 'border-[var(--secondary)] bg-[color-mix(in_srgb,var(--secondary)_12%,var(--surface))]' : 'border-[var(--border)]'}`}><span className="font-semibold text-main">{member.name}</span>{member.role && <span className="block text-sm text-subtle">{member.role}</span>}</button>)}</div>
        {compatibleStaff.length === 0 && <p className="text-sm text-subtle">No hay profesionales compatibles con este servicio.</p>}
      </fieldset>}
      {selectedService && bookingDate && staffForSlots.length > 0 && <fieldset className="space-y-3">
        <legend className="font-semibold text-main">4. Elige una hora</legend>
        {loadingSlots ? <p className="text-sm text-subtle" role="status">Consultando horarios disponibles...</p> : slotError ? <p className="text-sm text-main" role="alert">{slotError}</p> : slots.length === 0 ? <p className="text-sm text-subtle">No hay horarios disponibles para esta selección.</p> : <div className="flex flex-wrap gap-2">{slots.map((item) => <button key={item.time} type="button" onClick={() => { setSlot(item); setStep(5); }} aria-pressed={slot?.time === item.time} className={`rounded-lg border px-3 py-2 font-medium ${slot?.time === item.time ? 'border-[var(--secondary)] bg-[var(--secondary)] text-[var(--on-secondary)]' : 'border-[var(--border)] text-main'}`}>{item.time}</button>)}</div>}
      </fieldset>}
      {slot && <fieldset className="space-y-3">
        <legend className="font-semibold text-main">5. Tus datos</legend>
        <div className="grid gap-3 sm:grid-cols-2"><label className="field-label">Nombre completo<input className="field-input mt-1" autoComplete="name" value={clientName} onChange={(event) => setClientName(event.target.value)} required /></label><label className="field-label">Celular colombiano<input className="field-input mt-1" type="tel" inputMode="tel" autoComplete="tel" placeholder="300 123 4567" value={clientPhone} onChange={(event) => setClientPhone(event.target.value)} required aria-describedby="phone-help" /></label></div>
        <p id="phone-help" className="text-xs text-subtle">Usa un número móvil colombiano de 10 dígitos.</p>
        {clientPhone && !phoneValid && <p className="text-sm text-main" role="alert">Ingresa un celular colombiano válido.</p>}
        <label className="flex items-start gap-2 text-sm text-subtle"><input className="mt-1" type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />Autorizo el uso de mis datos para gestionar esta solicitud de cita.</label>
      </fieldset>}
      {canReview && selectedService && <section className="surface-soft space-y-3 rounded-xl p-4" aria-labelledby="review-title"><h3 id="review-title" className="font-semibold text-main">Revisa tu solicitud</h3><p className="text-sm text-subtle">{selectedService.name} · {formatDate(bookingDate)} · {slot?.time} · {staffChoice === 'any' ? 'Cualquier profesional disponible' : selectedStaff?.name}</p>{submitError && <p className="text-sm text-main" role="alert">{submitError}</p>}<button type="button" className="btn-primary rounded-xl px-4 py-2 font-semibold disabled:opacity-50" disabled={submitting} onClick={() => void submit()}>{submitting ? 'Enviando solicitud...' : 'Confirmar solicitud'}</button></section>}
    </>}
    {whatsappUrl && <p className="border-t border-[var(--border)] pt-4 text-sm text-subtle">¿Prefieres hablar con el negocio? <a className="font-semibold text-main underline" href={whatsappUrl} target="_blank" rel="noreferrer">Reserva por WhatsApp</a>.</p>}
  </div>;
}
