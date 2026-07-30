import React, { useEffect, useMemo, useRef, useState } from 'react';
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

type AvailableSlot = { time: string; staffId: string };

const COLOMBIAN_PHONE = /^(?:\+?57)?3\d{9}$/;
const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseDateKey(value: string): Date {
  return new Date(`${value}T12:00:00Z`);
}

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

function monthLabel(month: string): string {
  return new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', month: 'long', year: 'numeric' })
    .format(new Date(`${month}-01T12:00:00Z`));
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'full' })
    .format(parseDateKey(date));
}

function formatTime(time: string): string {
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(`1970-01-01T${time}:00-05:00`));
}

function getMonthDays(month: string): Array<string | null> {
  const start = new Date(`${month}-01T12:00:00Z`);
  const year = start.getUTCFullYear();
  const monthIndex = start.getUTCMonth();
  const firstWeekday = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  const count = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: count }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`),
  ];
}

function shiftMonth(month: string, offset: number): string {
  const date = new Date(`${month}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return monthKey(date);
}

function timePeriod(time: string): string {
  const minutes = timeToMinutes(time) || 0;
  if (minutes < 12 * 60) return 'Mañana';
  if (minutes < 18 * 60) return 'Tarde';
  return 'Noche';
}

export default function PublicBookingWidget({ business, whatsappUrl }: { business: PublicBusiness; whatsappUrl: string | null }) {
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [services, setServices] = useState<Service[]>([]);
  const [staff, setStaff] = useState<BarberStaff[]>([]);
  const [policyBusiness, setPolicyBusiness] = useState<PublicBusiness | null>(null);
  const [serviceId, setServiceId] = useState('');
  const [staffId, setStaffId] = useState('');
  const [bookingDate, setBookingDate] = useState('');
  const [calendarMonth, setCalendarMonth] = useState('');
  const [slot, setSlot] = useState<AvailableSlot | null>(null);
  const [locks, setLocks] = useState<Map<string, Set<string>>>(new Map());
  const [lockLoadFailures, setLockLoadFailures] = useState<Set<string>>(new Set());
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmedStaff, setConfirmedStaff] = useState<BarberStaff | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [recoverTime, setRecoverTime] = useState(false);
  const [contextAnnouncement, setContextAnnouncement] = useState('');
  const bookingHeadingRef = useRef<HTMLHeadingElement>(null);
  const timeSectionRef = useRef<HTMLDivElement>(null);

  const settings = useMemo(() => policyBusiness ? getBookingSettings(policyBusiness) : null, [policyBusiness]);
  const today = getBookingDate(new Date());
  const maximumDate = useMemo(() => {
    if (!settings) return today;
    const date = parseDateKey(today);
    date.setUTCDate(date.getUTCDate() + settings.bookingHorizonDays);
    return toDateKey(date);
  }, [settings, today]);
  const selectedService = services.find((service) => service.id === serviceId) || null;
  const compatibleStaff = useMemo(
    () => selectedService ? staff.filter((member) => isServiceCompatibleWithStaff(selectedService, member.id)) : [],
    [selectedService, staff],
  );
  const availabilityStaff = useMemo(
    () => staffId ? compatibleStaff.filter((member) => member.id === staffId) : compatibleStaff,
    [compatibleStaff, staffId],
  );
  const selectedStaff = compatibleStaff.find((member) => member.id === staffId) || null;
  const calendarDays = useMemo(() => getMonthDays(calendarMonth || monthKey(parseDateKey(today))), [calendarMonth, today]);
  const calendarWeeks = useMemo(() => Array.from(
    { length: Math.ceil(calendarDays.length / WEEKDAYS.length) },
    (_, index) => Array.from(
      { length: WEEKDAYS.length },
      (_, dayIndex) => calendarDays[index * WEEKDAYS.length + dayIndex] || null,
    ),
  ), [calendarDays]);
  const isClosure = (date: string) => settings?.exceptionalClosures.some((closure) => closure.date === date) || false;
  const minimumMonth = monthKey(parseDateKey(today));
  const maximumMonth = monthKey(parseDateKey(maximumDate));
  const slotError = selectedStaff && lockLoadFailures.has(selectedStaff.id)
    ? `No pudimos consultar los horarios de ${selectedStaff.name}. Inténtalo nuevamente.`
    : availabilityStaff.length > 0 && availabilityStaff.every((member) => lockLoadFailures.has(member.id))
      ? 'No pudimos consultar los horarios. Inténtalo nuevamente.'
      : '';

  const loadConfiguration = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const configuration = await loadPublicBookingConfiguration(business.id);
      setPolicyBusiness(configuration.business);
      setServices(configuration.services);
      setStaff(configuration.staff);
      setLoaded(true);
    } catch (error) {
      console.error(error);
      setLoadError('No pudimos cargar la configuración actual de reservas. No mostraremos horarios hasta que puedas reintentar.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!loaded && !loading) void loadConfiguration();
    // Configuration is intentionally stable for this booking session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!selectedService || !bookingDate || availabilityStaff.length === 0) {
      setLoadingSlots(false);
      return undefined;
    }
    const missingStaff = availabilityStaff.filter((member) => !locks.has(member.id) && !lockLoadFailures.has(member.id));
    if (missingStaff.length === 0) return undefined;

    setLoadingSlots(true);
    void Promise.allSettled(missingStaff.map((member) => loadPublicDateLocks(business.id, bookingDate, member.id)))
      .then((results) => {
        if (cancelled) return;

        setLocks((current) => {
          const next = new Map(current);
          results.forEach((result, index) => {
            if (result.status === 'fulfilled') next.set(missingStaff[index].id, result.value);
          });
          return next;
        });
        setLockLoadFailures((current) => {
          const next = new Set(current);
          results.forEach((result, index) => {
            const memberId = missingStaff[index].id;
            if (result.status === 'fulfilled') {
              next.delete(memberId);
            } else {
              console.error(result.reason);
              next.add(memberId);
            }
          });
          return next;
        });
      })
      .finally(() => {
        if (!cancelled) setLoadingSlots(false);
      });
    return () => { cancelled = true; };
  }, [availabilityStaff, bookingDate, business.id, lockLoadFailures, locks, selectedService]);

  useEffect(() => {
    if (recoverTime && !loadingSlots) {
      timeSectionRef.current?.focus();
      setRecoverTime(false);
    }
  }, [loadingSlots, recoverTime]);

  useEffect(() => {
    bookingHeadingRef.current?.focus();
    setContextAnnouncement('Sección de reservas. Reserva tu cita.');
  }, []);

  const slots = useMemo((): AvailableSlot[] => {
    if (!selectedService || !bookingDate || loadingSlots || slotError || !policyBusiness || !settings) return [];
    const byTime = new Map<string, AvailableSlot>();
    for (const member of availabilityStaff) {
      const schedule = getStaffSchedule(member, policyBusiness.workingHours);
      const interval = settings.slotIntervalMinutes;
      const weekday = parseDateKey(bookingDate).getUTCDay();
      const day = schedule[weekday] || { enabled: false, start: '00:00', end: '00:00', breaks: [] };
      const start = timeToMinutes(day.start);
      const end = timeToMinutes(day.end);
      if (!day.enabled || start === null || end === null || !Number.isInteger(interval) || interval <= 0) continue;
      for (let minute = start; minute < end; minute += interval) {
        const time = minutesToTime(minute);
        const required = time && getBookingLockIntervals(time, selectedService.duration, selectedService.bufferMinutes || 0, interval);
        const occupied = locks.get(member.id);
        if (!time || !required || !occupied || !checkBookingAvailability({
          business: policyBusiness,
          service: selectedService,
          staff: member,
          staffId: member.id,
          bookingDate,
          startTime: time,
        }).available || hasBookingLockConflict(required.map((item) => item.id), occupied)) continue;
        if (!byTime.has(time)) byTime.set(time, { time, staffId: member.id });
      }
    }
    return [...byTime.values()].sort((left, right) => left.time.localeCompare(right.time));
  }, [availabilityStaff, bookingDate, loadingSlots, locks, policyBusiness, selectedService, settings, slotError]);

  const slotsByPeriod = useMemo(() => slots.reduce<Record<string, AvailableSlot[]>>((groups, item) => {
    const period = timePeriod(item.time);
    (groups[period] ||= []).push(item);
    return groups;
  }, {}), [slots]);

  const chooseService = (nextServiceId: string) => {
    setServiceId(nextServiceId);
    setStaffId('');
    setBookingDate('');
    setCalendarMonth(minimumMonth);
    setSlot(null);
    setLocks(new Map());
    setLockLoadFailures(new Set());
    setSubmitError('');
  };

  const chooseStaff = (nextStaffId: string) => {
    setStaffId(nextStaffId);
    setSlot(null);
    setLocks(new Map());
    setLockLoadFailures(new Set());
    setSubmitError('');
  };

  const chooseDate = (nextDate: string) => {
    setBookingDate(nextDate);
    setSlot(null);
    setLocks(new Map());
    setLockLoadFailures(new Set());
    setSubmitError('');
  };

  const refreshSlots = () => {
    setLocks(new Map());
    setLockLoadFailures(new Set());
  };

  const phoneValid = COLOMBIAN_PHONE.test(clientPhone.replace(/[\s()-]/g, ''));
  const canConfirm = Boolean(slot && clientName.trim() && phoneValid && consent);
  const submit = async () => {
    if (!selectedService || !bookingDate || !slot || !canConfirm) return;
    const staffMember = staff.find((member) => member.id === slot.staffId);
    if (!staffMember) return;
    setSubmitting(true);
    setSubmitError('');
    const result = await createClientBooking(
      { businessId: business.id, bookingDate, startTime: slot.time, clientName, clientPhone: clientPhone.replace(/[\s()-]/g, '') },
      { business, service: selectedService, staff: staffMember } satisfies PublicBookingConfiguration,
    );
    setSubmitting(false);
    if (result.ok === true) {
      setConfirmedStaff(staffMember);
      setConfirmed(true);
      return;
    }
    refreshSlots();
    setSubmitError(result.message);
    if (result.code === 'conflict' || result.code === 'unavailable') {
      setSlot(null);
      setRecoverTime(true);
    }
  };

  if (confirmed && selectedService && bookingDate && slot) {
    return <div className="booking-sheet space-y-4" role="status" aria-live="polite">
      <p className="press-label text-[var(--success)]">Registro enviado</p>
      <h2 className="text-xl font-bold text-main">Solicitud de reserva recibida</h2>
      <p className="text-subtle">Tu reserva está pendiente de confirmación.</p>
      <dl className="surface-soft grid gap-3 rounded p-4 text-sm sm:grid-cols-2">
        <div><dt className="text-subtle">Servicio</dt><dd className="font-semibold text-main">{selectedService.name}</dd></div>
        <div><dt className="text-subtle">Fecha y hora</dt><dd className="font-semibold text-main">{formatDate(bookingDate)} · {formatTime(slot.time)}</dd></div>
        <div><dt className="text-subtle">Profesional</dt><dd className="font-semibold text-main">{confirmedStaff?.name}</dd></div>
        <div><dt className="text-subtle">Estado</dt><dd className="font-semibold text-main">Pendiente</dd></div>
      </dl>
    </div>;
  }

  return <div className="booking-sheet space-y-7" aria-busy={loading || loadingSlots || submitting}>
    <div>
      <p className="press-label accent-text">Reserva en línea</p>
      <h2 ref={bookingHeadingRef} tabIndex={-1} className="mt-2 text-2xl font-semibold text-main focus:outline-none">Reserva tu cita</h2>
      <p className="mt-2 max-w-2xl text-sm text-subtle">Elige un servicio, un profesional si lo prefieres y una hora realmente disponible. Todos los horarios están en hora de Colombia.</p>
    </div>

    <div className="sr-only" aria-live="polite" aria-atomic="true">{contextAnnouncement}</div>

    <div className="sr-only" role="status" aria-live="polite">
      {loadingSlots ? 'Consultando horarios disponibles.' : bookingDate && !slotError ? `${slots.length} horarios disponibles para ${formatDate(bookingDate)}.` : ''}
    </div>

    {loadError && <div className="error-notice flex flex-wrap items-center gap-3 rounded p-3 text-sm" role="alert">
      <span>{loadError}</span>
      <button type="button" className="btn-outline px-3 py-1 text-sm" onClick={() => void loadConfiguration()}>Reintentar</button>
    </div>}
    {loading && <p className="text-subtle" role="status">Cargando la configuración actual de reservas...</p>}

    {!loading && !loadError && <>
      <fieldset className="space-y-3">
        <legend className="text-base font-semibold text-main">1. Elige un servicio</legend>
        {services.length === 0 ? <p className="text-sm text-subtle">Este negocio no tiene servicios disponibles para reservar.</p> : (
          <div className="grid gap-2 sm:grid-cols-2">
            {services.map((service) => <button key={service.id} type="button" onClick={() => chooseService(service.id)} aria-pressed={service.id === serviceId} className={`booking-choice min-h-11 rounded border p-3 text-left ${service.id === serviceId ? 'is-selected' : ''}`}>
              <span className="block font-semibold text-main">{service.name}</span>
              <span className="text-sm text-subtle">{service.duration} min</span>
            </button>)}
          </div>
        )}
      </fieldset>

      {selectedService && <section className="space-y-5" aria-labelledby="booking-date-title">
        <div className="booking-section-heading">
          <div>
            <h3 id="booking-date-title" className="text-base font-semibold text-main">2. Profesional y fecha</h3>
            <p className="mt-1 text-sm text-subtle">Puedes dejar que encontremos el primer profesional disponible.</p>
          </div>
          <div className="booking-summary" aria-label="Selección actual">
            <span>{selectedService.name}</span>
            {bookingDate && <span>{formatDate(bookingDate)}</span>}
            {selectedStaff && <span>{selectedStaff.name}</span>}
          </div>
        </div>

        {compatibleStaff.length === 0 ? <div className="surface-soft rounded p-4 text-sm text-subtle" role="status">No hay profesionales activos para este servicio. Elige otro servicio o contacta al negocio.</div> : <>
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-main">Profesional <span className="font-normal text-subtle">(opcional)</span></legend>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={`booking-provider min-h-11 ${staffId === '' ? 'is-selected' : ''}`} aria-pressed={staffId === ''} onClick={() => chooseStaff('')}>Cualquier profesional</button>
              {compatibleStaff.map((member) => <button key={member.id} type="button" className={`booking-provider min-h-11 ${staffId === member.id ? 'is-selected' : ''}`} aria-pressed={staffId === member.id} onClick={() => chooseStaff(member.id)}>{member.name}</button>)}
            </div>
          </fieldset>

          <div className="booking-calendar" aria-label="Selecciona una fecha">
            <div className="booking-calendar-header">
              <button type="button" className="btn-outline min-h-11 min-w-11 px-3" aria-label="Mes anterior" onClick={() => setCalendarMonth((month) => shiftMonth(month || minimumMonth, -1))} disabled={calendarMonth <= minimumMonth}>←</button>
              <h4 className="font-semibold capitalize text-main" aria-live="polite">{monthLabel(calendarMonth || minimumMonth)}</h4>
              <button type="button" className="btn-outline min-h-11 min-w-11 px-3" aria-label="Mes siguiente" onClick={() => setCalendarMonth((month) => shiftMonth(month || minimumMonth, 1))} disabled={calendarMonth >= maximumMonth}>→</button>
            </div>
            <table className="booking-calendar-grid" aria-label={`Fechas de ${monthLabel(calendarMonth || minimumMonth)}`}>
              <thead><tr>{WEEKDAYS.map((day) => <th key={day} scope="col" className="booking-calendar-weekday">{day}</th>)}</tr></thead>
              <tbody>{calendarWeeks.map((week, weekIndex) => <tr key={`week-${weekIndex}`}>
                {week.map((date, dayIndex) => {
                  if (!date) return <td key={`blank-${dayIndex}`} aria-hidden="true" />;
                  const unavailable = date < today || date > maximumDate || isClosure(date);
                  const selected = date === bookingDate;
                  return <td key={date}><button type="button" className={`booking-calendar-day min-h-11 ${selected ? 'is-selected' : ''}`} aria-pressed={selected} aria-label={`${formatDate(date)}${unavailable ? ', no disponible' : ''}`} disabled={unavailable} onClick={() => chooseDate(date)}>{Number(date.slice(-2))}</button></td>;
                })}
              </tr>)}</tbody>
            </table>
            <p className="mt-3 text-xs text-subtle">Las fechas atenuadas están fuera del periodo de reserva o el negocio no atiende ese día. Consultaremos las horas al elegir una fecha.</p>
          </div>
        </>}
      </section>}

      {selectedService && bookingDate && <section ref={timeSectionRef} tabIndex={-1} className="space-y-4 focus:outline-none" aria-labelledby="booking-time-title">
        <div>
          <h3 id="booking-time-title" className="text-base font-semibold text-main">3. Hora disponible</h3>
          <p className="mt-1 text-sm text-subtle">{formatDate(bookingDate)}{selectedStaff ? ` con ${selectedStaff.name}` : ', con el primer profesional disponible'}.</p>
        </div>
        {loadingSlots ? <div className="booking-loading surface-soft rounded p-4" role="status">Buscando horarios disponibles...</div> : slotError ? <div className="error-notice flex flex-wrap items-center gap-3 rounded p-3 text-sm" role="alert"><span>{slotError}</span><button type="button" className="btn-outline px-3 py-1 text-sm" onClick={refreshSlots}>Reintentar</button></div> : slots.length === 0 ? <div className="surface-soft rounded p-4 text-sm"><p className="font-semibold text-main">No quedan horarios disponibles para esta fecha.</p><p className="mt-1 text-subtle">Prueba otro día o deja seleccionado cualquier profesional.</p><button type="button" className="btn-outline mt-3 px-3 py-1 text-sm" onClick={() => setCalendarMonth((month) => shiftMonth(month || minimumMonth, 1))} disabled={calendarMonth >= maximumMonth}>Ver otra fecha</button></div> : <div className="space-y-4">
          {(['Mañana', 'Tarde', 'Noche'] as const).map((period) => slotsByPeriod[period]?.length ? <div key={period}><h4 className="mb-2 text-sm font-semibold text-main">{period}</h4><div className="flex flex-wrap gap-2">{slotsByPeriod[period].map((item) => <button key={`${item.time}-${item.staffId}`} type="button" className={`booking-time min-h-11 ${slot?.time === item.time && slot.staffId === item.staffId ? 'is-selected' : ''}`} aria-pressed={slot?.time === item.time && slot.staffId === item.staffId} onClick={() => { setSlot(item); setSubmitError(''); }}>{formatTime(item.time)}</button>)}</div></div> : null)}
        </div>}
      </section>}

      {slot && selectedService && bookingDate && <section className="space-y-4" aria-labelledby="booking-contact-title">
        <div><h3 id="booking-contact-title" className="text-base font-semibold text-main">4. Tus datos y confirmación</h3><p className="mt-1 text-sm text-subtle">Usaremos estos datos solo para gestionar tu solicitud.</p></div>
        <div className="booking-confirmation-summary"><span>{selectedService.name}</span><span>{formatDate(bookingDate)} · {formatTime(slot.time)}</span><span>{staff.find((member) => member.id === slot.staffId)?.name}</span></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1"><span className="field-label text-sm">Nombre</span><input className="field-input" value={clientName} onChange={(event) => setClientName(event.target.value)} autoComplete="name" /></label>
          <label className="space-y-1"><span className="field-label text-sm">Celular colombiano</span><input className="field-input" value={clientPhone} onChange={(event) => setClientPhone(event.target.value)} autoComplete="tel" inputMode="tel" placeholder="300 123 4567" aria-describedby="phone-hint" /></label>
        </div>
        <p id="phone-hint" className="text-xs text-subtle">Ejemplo: 300 123 4567</p>
        <label className="flex items-start gap-3 text-sm text-main"><input className="mt-1 h-4 w-4" type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>Acepto que el negocio use mis datos para responder y gestionar esta reserva.</span></label>
        {submitError && <div className="error-notice rounded p-3 text-sm" role="alert">{submitError}</div>}
        <div className="flex flex-wrap items-center gap-3"><button type="button" className="btn-primary px-4 py-2" onClick={() => void submit()} disabled={!canConfirm || submitting}>{submitting ? 'Enviando solicitud...' : 'Enviar solicitud de reserva'}</button>{whatsappUrl && <a className="accent-link text-sm font-semibold text-main underline" href={whatsappUrl} target="_blank" rel="noreferrer">¿Prefieres escribir por WhatsApp?</a>}</div>
      </section>}
    </>}
  </div>;
}
