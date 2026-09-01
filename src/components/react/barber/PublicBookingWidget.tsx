import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  bookingRequestsAdditionalCustomerData,
  checkBookingAvailability,
  getBookingDate,
  getBookingLockIntervals,
  getBookingSettings,
  hasBookingLockConflict,
  isPublicBookingAvailable,
  isBookingDateFullyClosed,
  isServiceCompatibleWithStaff,
  minutesToTime,
  timeToMinutes,
  type BookingAvailabilityReason,
} from '../../../lib/booking';
import {
  BOOKING_NOTE_MAX_LENGTH,
  createClientBooking,
  normalizeBookingNote,
  type PublicBookingConfiguration,
} from '../../../lib/booking-transaction';
import { loadPublicBookingConfiguration, loadPublicDateLocks } from '../../../lib/public-booking';
import type {
  AppointmentProductRequest,
  PublicBookingProduct,
  PublicBookingService,
  PublicBookingStaff,
  PublicBusiness,
} from '../../../lib/types';

type BookingSlot = {
  time: string;
  staffId?: string;
  available: boolean;
  unavailableReason?: string;
};

const COLOMBIAN_PHONE = /^(?:\+?57)?3\d{9}$/;
const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const AVAILABILITY_REASON_LABELS: Record<BookingAvailabilityReason, string> = {
  business_inactive: 'El negocio no recibe solicitudes.',
  service_inactive: 'Este servicio no está disponible.',
  staff_inactive: 'El profesional no está disponible.',
  service_incompatible: 'Este profesional no presta este servicio.',
  invalid_date: 'La fecha no es válida.',
  outside_booking_window: 'Fuera del periodo disponible.',
  exceptional_closure: 'El negocio está cerrado.',
  closure_rule: 'El negocio está cerrado.',
  outside_schedule: 'Fuera de horario.',
  overlaps_break: 'El profesional está en descanso.',
  invalid_slot: 'Horario no disponible.',
};

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
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${month}-01T12:00:00Z`));
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'full' }).format(
    parseDateKey(date),
  );
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
    ...Array.from(
      { length: count },
      (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`,
    ),
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

function formatPrice(price: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(price);
}

function BookingProductThumbnail({ product }: { product: PublicBookingProduct }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [product.imageUrl]);
  if (product.imageUrl && !failed) {
    return (
      <img
        className="booking-product-thumbnail"
        src={product.imageUrl}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div
      className="booking-product-thumbnail booking-product-thumbnail-placeholder"
      aria-hidden="true"
    >
      {product.name.slice(0, 1).toLocaleUpperCase('es-CO')}
    </div>
  );
}

function BookingStaffAvatar({ member }: { member: PublicBookingStaff }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [member.photoUrl]);
  const initial = member.name.trim().slice(0, 1).toLocaleUpperCase('es-CO') || '•';

  if (member.photoUrl && !failed) {
    return (
      <img
        className="booking-staff-avatar"
        src={member.photoUrl}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span className="booking-staff-avatar booking-staff-avatar-placeholder" aria-hidden="true">
      {initial}
    </span>
  );
}

export default function PublicBookingWidget({
  business,
  products: publicProducts,
  services: publicServices,
  staff: publicStaff,
  whatsappUrl,
}: {
  business: PublicBusiness;
  products: PublicBookingProduct[];
  services: PublicBookingService[];
  staff: PublicBookingStaff[];
  whatsappUrl: string | null;
}) {
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [services, setServices] = useState<PublicBookingService[]>([]);
  const [staff, setStaff] = useState<PublicBookingStaff[]>([]);
  const [products, setProducts] = useState<PublicBookingProduct[]>([]);
  const [requestedProductQuantities, setRequestedProductQuantities] = useState<
    Record<string, number>
  >({});
  const [policyBusiness, setPolicyBusiness] = useState<PublicBusiness | null>(null);
  const [serviceId, setServiceId] = useState('');
  const [staffId, setStaffId] = useState('');
  const [bookingDate, setBookingDate] = useState('');
  const [calendarMonth, setCalendarMonth] = useState('');
  const [slot, setSlot] = useState<BookingSlot | null>(null);
  const [locks, setLocks] = useState<Map<string, Set<string>>>(new Map());
  const [lockLoadFailures, setLockLoadFailures] = useState<Set<string>>(new Set());
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientAddress, setClientAddress] = useState('');
  const [bookingNote, setBookingNote] = useState('');
  const [consent, setConsent] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmedStaff, setConfirmedStaff] = useState<PublicBookingStaff | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [recoverTime, setRecoverTime] = useState(false);
  const [contextAnnouncement, setContextAnnouncement] = useState('');
  const [validationToast, setValidationToast] = useState('');
  const bookingHeadingRef = useRef<HTMLHeadingElement>(null);
  const timeSectionRef = useRef<HTMLDivElement>(null);
  const validationToastRef = useRef<HTMLDivElement>(null);
  const idempotencyKeyRef = useRef<string | null>(null);

  const settings = useMemo(
    () => (policyBusiness ? getBookingSettings(policyBusiness) : null),
    [policyBusiness],
  );
  const today = getBookingDate(new Date());
  const maximumDate = useMemo(() => {
    if (!settings) return today;
    const date = parseDateKey(today);
    date.setUTCDate(date.getUTCDate() + settings.bookingHorizonDays);
    return toDateKey(date);
  }, [settings, today]);
  const selectedService = services.find((service) => service.id === serviceId) || null;
  const compatibleStaff = useMemo(
    () =>
      selectedService
        ? staff.filter((member) => isServiceCompatibleWithStaff(selectedService, member.id))
        : [],
    [selectedService, staff],
  );
  const availabilityStaff = useMemo(
    () => (staffId ? compatibleStaff.filter((member) => member.id === staffId) : compatibleStaff),
    [compatibleStaff, staffId],
  );
  const selectedStaff = compatibleStaff.find((member) => member.id === staffId) || null;
  const calendarDays = useMemo(
    () => getMonthDays(calendarMonth || monthKey(parseDateKey(today))),
    [calendarMonth, today],
  );
  const calendarWeeks = useMemo(
    () =>
      Array.from({ length: Math.ceil(calendarDays.length / WEEKDAYS.length) }, (_, index) =>
        Array.from(
          { length: WEEKDAYS.length },
          (_, dayIndex) => calendarDays[index * WEEKDAYS.length + dayIndex] || null,
        ),
      ),
    [calendarDays],
  );
  const getCalendarDateUnavailableReason = (date: string): string | null => {
    if (date < today) return 'La fecha ya pasó.';
    if (date > maximumDate) return 'La fecha está fuera del periodo disponible para agendar.';
    if (isBookingDateFullyClosed(settings || { closureRules: [], exceptionalClosures: [] }, date))
      return 'El negocio no recibe solicitudes ese día.';
    const weekday = parseDateKey(date).getUTCDay();
    if (!policyBusiness?.workingHours[weekday]?.enabled) return 'El negocio no atiende ese día.';
    return null;
  };
  const minimumMonth = monthKey(parseDateKey(today));
  const maximumMonth = monthKey(parseDateKey(maximumDate));
  const slotError =
    selectedStaff && lockLoadFailures.has(selectedStaff.id)
      ? `No pudimos consultar los horarios de ${selectedStaff.name}. Inténtalo nuevamente.`
      : !selectedStaff && lockLoadFailures.size > 0
        ? 'No pudimos verificar todos los horarios disponibles. Inténtalo nuevamente.'
        : '';

  const loadConfiguration = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const configuration = loadPublicBookingConfiguration(
        business,
        publicProducts,
        publicServices,
        publicStaff,
      );
      setPolicyBusiness(configuration.business);
      setServices(configuration.services);
      setStaff(configuration.staff);
      setProducts(configuration.products);
      setLoaded(true);
    } catch (error) {
      console.error(error);
      setLoadError(
        'No pudimos cargar la configuración actual de agendamiento. No mostraremos horarios hasta que puedas reintentar.',
      );
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
    const missingStaff = availabilityStaff.filter(
      (member) => !locks.has(member.id) && !lockLoadFailures.has(member.id),
    );
    if (missingStaff.length === 0) return undefined;

    setLoadingSlots(true);
    void Promise.allSettled(
      missingStaff.map((member) => loadPublicDateLocks(business.id, bookingDate, member.id)),
    )
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
    return () => {
      cancelled = true;
    };
  }, [availabilityStaff, bookingDate, business.id, lockLoadFailures, locks, selectedService]);

  useEffect(() => {
    if (recoverTime && !loadingSlots) {
      timeSectionRef.current?.focus();
      setRecoverTime(false);
    }
  }, [loadingSlots, recoverTime]);

  useEffect(() => {
    bookingHeadingRef.current?.focus();
    setContextAnnouncement('Sección de agendamiento. Envía tu solicitud.');
  }, []);

  useEffect(() => {
    if (validationToast) validationToastRef.current?.focus();
  }, [validationToast]);

  const slots = useMemo((): BookingSlot[] => {
    if (
      !selectedService ||
      !bookingDate ||
      loadingSlots ||
      slotError ||
      !policyBusiness ||
      !settings
    )
      return [];
    const weekday = parseDateKey(bookingDate).getUTCDay();
    const businessDay = policyBusiness.workingHours[weekday];
    const interval = settings.slotIntervalMinutes;
    const start = timeToMinutes(businessDay?.open || '');
    const end = timeToMinutes(businessDay?.close || '');
    if (
      !businessDay?.enabled ||
      start === null ||
      end === null ||
      !Number.isInteger(interval) ||
      interval <= 0
    )
      return [];

    const candidates: BookingSlot[] = [];
    for (let minute = start; minute < end; minute += interval) {
      const time = minutesToTime(minute);
      const required =
        time &&
        getBookingLockIntervals(
          time,
          selectedService.duration,
          selectedService.bufferMinutes || 0,
          interval,
        );
      const evaluations =
        time && required
          ? availabilityStaff.map((member) => {
              const occupied = locks.get(member.id);
              const availability = checkBookingAvailability({
                business: policyBusiness,
                service: selectedService,
                staff: member,
                staffId: member.id,
                bookingDate,
                startTime: time,
              });
              if (availability.available === false)
                return {
                  member,
                  available: false,
                  reason: AVAILABILITY_REASON_LABELS[availability.reason],
                };
              if (
                !occupied ||
                hasBookingLockConflict(
                  required.map((item) => item.id),
                  occupied,
                )
              )
                return { member, available: false, reason: 'Ocupado.' };
              return { member, available: true };
            })
          : [];
      const availableStaff = evaluations.find((evaluation) => evaluation.available);
      if (time)
        candidates.push({
          time,
          available: Boolean(availableStaff),
          ...(availableStaff
            ? { staffId: availableStaff.member.id }
            : { unavailableReason: evaluations[0]?.reason || 'Horario no disponible.' }),
        });
    }
    return candidates;
  }, [
    availabilityStaff,
    bookingDate,
    loadingSlots,
    locks,
    policyBusiness,
    selectedService,
    settings,
    slotError,
  ]);

  const availableSlotCount = slots.filter((item) => item.available).length;
  const slotsByPeriod = useMemo(
    () =>
      slots.reduce<Record<string, BookingSlot[]>>((groups, item) => {
        const period = timePeriod(item.time);
        (groups[period] ||= []).push(item);
        return groups;
      }, {}),
    [slots],
  );

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
  const productSelectionEnabled = settings?.productSelectionEnabled === true;
  const selectableProducts = productSelectionEnabled ? products : [];
  const requestedProducts = useMemo(
    (): AppointmentProductRequest[] =>
      selectableProducts.flatMap((product) => {
        const quantity = requestedProductQuantities[product.id];
        return quantity ? [{ productId: product.id, name: product.name, quantity }] : [];
      }),
    [selectableProducts, requestedProductQuantities],
  );
  const requestedProductSubtotal = useMemo(
    () =>
      requestedProducts.reduce(
        (total, item) =>
          total +
          (selectableProducts.find((product) => product.id === item.productId)?.price || 0) *
            item.quantity,
        0,
      ),
    [requestedProducts, selectableProducts],
  );
  const setProductQuantity = (productId: string, quantity: number) => {
    setRequestedProductQuantities((current) => {
      const next = { ...current };
      if (quantity <= 0) delete next[productId];
      else next[productId] = Math.min(quantity, 10);
      return next;
    });
  };
  const customerFields = settings?.customerFields;
  const emailRequested = customerFields?.email !== undefined && customerFields.email !== 'disabled';
  const addressRequested =
    customerFields?.address !== undefined && customerFields.address !== 'disabled';
  const requiresPrivacyAcceptance = customerFields
    ? bookingRequestsAdditionalCustomerData(customerFields)
    : false;
  const emailValue = clientEmail.trim();
  const addressValue = clientAddress.trim();
  const normalizedBookingNote = normalizeBookingNote(bookingNote);
  const emailValid =
    !emailValue || (emailValue.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue));
  const nameValid = clientName.trim().length >= 1 && clientName.trim().length <= 120;
  const phoneLengthValid = clientPhone.replace(/[\s()-]/g, '').length <= 40;
  const addressValid = addressValue.length <= 240;
  const bookingNoteValid = bookingNote.length <= BOOKING_NOTE_MAX_LENGTH;
  const canConfirm = Boolean(
    slot &&
    nameValid &&
    phoneValid &&
    phoneLengthValid &&
    emailValid &&
    addressValid &&
    bookingNoteValid &&
    (!emailRequested || customerFields?.email !== 'required' || emailValue) &&
    (!addressRequested || customerFields?.address !== 'required' || addressValue) &&
    (!requiresPrivacyAcceptance || consent),
  );
  const validationIssues = [
    !selectedService && 'elige un servicio',
    !bookingDate && 'selecciona una fecha',
    !slot && 'elige un horario',
    !nameValid && 'ingresa un nombre',
    (!phoneValid || !phoneLengthValid) &&
      'ingresa un celular válido',
    emailRequested &&
      (!emailValid || (customerFields?.email === 'required' && !emailValue)) &&
      'ingresa un correo electrónico válido',
    addressRequested &&
      (!addressValid || (customerFields?.address === 'required' && !addressValue)) &&
      'ingresa una dirección válida',
    !bookingNoteValid && `reduce la nota a ${BOOKING_NOTE_MAX_LENGTH} caracteres o menos`,
    requiresPrivacyAcceptance &&
      !consent &&
      'acepta los documentos de privacidad para compartir estos datos',
  ].filter(Boolean) as string[];
  const showValidationToast = () => {
    const requirements =
      validationIssues.length === 1
        ? validationIssues[0]
        : `${validationIssues.slice(0, -1).join(', ')} y ${validationIssues.at(-1)}`;
    setValidationToast(`Para enviar la solicitud, ${requirements}.`);
  };
  const submit = async () => {
    if (!canConfirm) {
      showValidationToast();
      return;
    }
    if (!selectedService || !bookingDate || !slot) return;
    const staffMember = staff.find((member) => member.id === slot.staffId);
    if (!staffMember) return;
    setSubmitting(true);
    setSubmitError('');
    idempotencyKeyRef.current ||= crypto.randomUUID();
    const result = await createClientBooking(
      {
        businessId: business.id,
        serviceId: selectedService.id,
        bookingDate,
        startTime: slot.time,
        clientName,
        clientPhone: clientPhone.replace(/[\s()-]/g, ''),
        idempotencyKey: idempotencyKeyRef.current,
        ...(emailRequested ? { clientEmail } : {}),
        ...(addressRequested ? { clientAddress } : {}),
        ...(normalizedBookingNote ? { notes: normalizedBookingNote } : {}),
        ...(requiresPrivacyAcceptance ? { acceptedBookingPrivacy: consent } : {}),
        ...(productSelectionEnabled && requestedProducts.length ? { requestedProducts } : {}),
        anyProfessional: !staffId,
        ...(staffId ? { staffId: slot.staffId } : {}),
      },
      {
        business,
        service: selectedService,
        staff: staffMember,
        ...(staffId ? {} : { compatibleStaff }),
      } satisfies PublicBookingConfiguration,
    );
    setSubmitting(false);
    if (result.ok === true) {
      setConfirmedStaff(staffMember);
      setConfirmed(true);
      return;
    }
    if (result.code !== 'network') idempotencyKeyRef.current = null;
    refreshSlots();
    setSubmitError(result.message);
    if (result.code === 'conflict' || result.code === 'unavailable') {
      setSlot(null);
      setRecoverTime(true);
    }
  };

  if (!isPublicBookingAvailable(business)) {
    return (
      <div className="booking-sheet space-y-3" role="status">
        <p className="press-label text-subtle">Agendamiento no disponible</p>
        <h2 className="text-xl font-bold text-main">
          Este negocio no recibe solicitudes en línea.
        </h2>
      </div>
    );
  }

  if (confirmed && selectedService && bookingDate && slot) {
    return (
      <div className="booking-sheet space-y-4" role="status" aria-live="polite">
        <p className="press-label text-[var(--success)]">Registro enviado</p>
        <h2 className="text-xl font-bold text-main">Solicitud de agendamiento recibida</h2>
        <p className="text-subtle">Tu solicitud está pendiente de confirmación.</p>
        <dl className="surface-soft grid gap-3 rounded p-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-subtle">Servicio</dt>
            <dd className="font-semibold text-main">{selectedService.name}</dd>
          </div>
          <div>
            <dt className="text-subtle">Fecha y hora</dt>
            <dd className="font-semibold text-main">
              {formatDate(bookingDate)} · {formatTime(slot.time)}
            </dd>
          </div>
          <div>
            <dt className="text-subtle">Profesional</dt>
            <dd className="font-semibold text-main">
              {staffId ? confirmedStaff?.name : 'El negocio asignará a tu profesional.'}
            </dd>
          </div>
          <div>
            <dt className="text-subtle">Estado</dt>
            <dd className="font-semibold text-main">Pendiente</dd>
          </div>
        </dl>
      </div>
    );
  }

  return (
    <div className="booking-sheet space-y-7" aria-busy={loading || loadingSlots || submitting}>
      {validationToast && (
        <section
          className="floating-notifications"
          aria-label="Requisitos para enviar la solicitud"
        >
          <div
            ref={validationToastRef}
            tabIndex={-1}
            className="floating-notification floating-notification-error"
            role="alert"
            aria-atomic="true"
          >
            <span className="floating-notification-icon" aria-hidden="true">
              !
            </span>
            <div className="floating-notification-content">
              <p className="floating-notification-label">Revisa la solicitud</p>
              <p className="floating-notification-message">{validationToast}</p>
            </div>
            <button
              type="button"
              className="floating-notification-dismiss"
              onClick={() => setValidationToast('')}
              aria-label="Cerrar requisitos"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        </section>
      )}
      <div>
        <p className="press-label accent-text">Agendamiento en línea</p>
        <h2
          ref={bookingHeadingRef}
          tabIndex={-1}
          className="mt-2 text-2xl font-semibold text-main focus:outline-none"
        >
          Agenda tu servicio
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-subtle">
          Elige un servicio, un profesional si lo prefieres y una hora realmente disponible. Todos
          los horarios están en hora de Colombia.
        </p>
      </div>

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {contextAnnouncement}
      </div>

      <div className="sr-only" role="status" aria-live="polite">
        {loadingSlots
          ? 'Consultando horarios disponibles.'
          : bookingDate && !slotError
            ? `${slots.length} horarios disponibles para ${formatDate(bookingDate)}.`
            : ''}
      </div>

      {loadError && (
        <div
          className="error-notice flex flex-wrap items-center gap-3 rounded p-3 text-sm"
          role="alert"
        >
          <span>{loadError}</span>
          <button
            type="button"
            className="btn-outline px-3 py-1 text-sm"
            onClick={() => void loadConfiguration()}
          >
            Reintentar
          </button>
        </div>
      )}
      {loading && (
        <p className="text-subtle" role="status">
          Cargando la configuración actual de agendamiento...
        </p>
      )}

      {!loading && !loadError && (
        <>
          <fieldset className="space-y-3">
            <legend className="text-base font-semibold text-main">1. Elige un servicio</legend>
            {services.length === 0 ? (
              <p className="text-sm text-subtle">
                Este negocio no tiene servicios disponibles para agendar.
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {services.map((service) => (
                  <button
                    key={service.id}
                    type="button"
                    onClick={() => chooseService(service.id)}
                    aria-pressed={service.id === serviceId}
                    className={`booking-choice min-h-11 rounded border p-3 text-left ${service.id === serviceId ? 'is-selected' : ''}`}
                  >
                    <span className="block font-semibold text-main">{service.name}</span>
                    <span className="text-sm text-subtle">{service.duration} min</span>
                  </button>
                ))}
              </div>
            )}
          </fieldset>

          {selectedService && (
            <section className="space-y-5" aria-labelledby="booking-date-title">
              <div className="booking-section-heading">
                <div>
                  <h3 id="booking-date-title" className="text-base font-semibold text-main">
                    2. Profesional y fecha
                  </h3>
                  <p className="mt-1 text-sm text-subtle">
                    Puedes dejar que encontremos el primer profesional disponible.
                  </p>
                </div>
                <div className="booking-summary" aria-label="Selección actual">
                  <span>{selectedService.name}</span>
                  {bookingDate && <span>{formatDate(bookingDate)}</span>}
                  {selectedStaff && <span>{selectedStaff.name}</span>}
                </div>
              </div>

              {compatibleStaff.length === 0 ? (
                <div className="surface-soft rounded p-4 text-sm text-subtle" role="status">
                  No hay profesionales activos para este servicio. Elige otro servicio o contacta al
                  negocio.
                </div>
              ) : (
                <>
                  <fieldset className="space-y-2">
                    <legend className="text-sm font-semibold text-main">
                      Profesional <span className="font-normal text-subtle">(opcional)</span>
                    </legend>
                    <div className="booking-provider-grid">
                      <button
                        type="button"
                        className={`booking-provider booking-provider-any min-h-11 ${staffId === '' ? 'is-selected' : ''}`}
                        aria-pressed={staffId === ''}
                        onClick={() => chooseStaff('')}
                      >
                        <span className="booking-provider-any-icon" aria-hidden="true">✦</span>
                        <span>
                          <strong>Cualquier profesional</strong>
                          <small>Te asignaremos el mejor horario</small>
                        </span>
                      </button>
                      {compatibleStaff.map((member) => (
                        <button
                          key={member.id}
                          type="button"
                          className={`booking-provider min-h-11 ${staffId === member.id ? 'is-selected' : ''}`}
                          aria-pressed={staffId === member.id}
                          onClick={() => chooseStaff(member.id)}
                        >
                          <BookingStaffAvatar member={member} />
                          <span className="booking-provider-copy">
                            <strong>{member.name}</strong>
                            <small>{staffId === member.id ? 'Profesional seleccionado' : 'Ver disponibilidad'}</small>
                          </span>
                          <span className="booking-provider-check" aria-hidden="true">✓</span>
                        </button>
                      ))}
                    </div>
                  </fieldset>

                  <div className="booking-calendar" aria-label="Selecciona una fecha">
                    <p id="booking-unavailable-date-hint" className="sr-only">
                      Fecha no disponible para este agendamiento. Elige otro día.
                    </p>
                    <div className="booking-calendar-header">
                      <button
                        type="button"
                        className="btn-outline min-h-11 min-w-11 px-3"
                        aria-label="Mes anterior"
                        onClick={() =>
                          setCalendarMonth((month) => shiftMonth(month || minimumMonth, -1))
                        }
                        disabled={calendarMonth <= minimumMonth}
                      >
                        ←
                      </button>
                      <h4 className="font-semibold capitalize text-main" aria-live="polite">
                        {monthLabel(calendarMonth || minimumMonth)}
                      </h4>
                      <button
                        type="button"
                        className="btn-outline min-h-11 min-w-11 px-3"
                        aria-label="Mes siguiente"
                        onClick={() =>
                          setCalendarMonth((month) => shiftMonth(month || minimumMonth, 1))
                        }
                        disabled={calendarMonth >= maximumMonth}
                      >
                        →
                      </button>
                    </div>
                    <table
                      className="booking-calendar-grid"
                      aria-label={`Fechas de ${monthLabel(calendarMonth || minimumMonth)}`}
                    >
                      <thead>
                        <tr>
                          {WEEKDAYS.map((day) => (
                            <th key={day} scope="col" className="booking-calendar-weekday">
                              {day}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {calendarWeeks.map((week, weekIndex) => (
                          <tr key={`week-${weekIndex}`}>
                            {week.map((date, dayIndex) => {
                              if (!date) return <td key={`blank-${dayIndex}`} aria-hidden="true" />;
                              const unavailableReason = getCalendarDateUnavailableReason(date);
                              const unavailable = Boolean(unavailableReason);
                              const selected = date === bookingDate;
                              return (
                                <td key={date}>
                                  <button
                                    type="button"
                                    className={`booking-calendar-day min-h-11 ${selected ? 'is-selected' : ''} ${unavailable ? 'is-unavailable' : ''}`}
                                    aria-pressed={selected}
                                    aria-label={`${formatDate(date)}${unavailable ? `. No disponible: ${unavailableReason}` : ''}`}
                                    aria-describedby={
                                      unavailable ? 'booking-unavailable-date-hint' : undefined
                                    }
                                    title={unavailableReason || undefined}
                                    disabled={unavailable}
                                    onClick={() => chooseDate(date)}
                                  >
                                    {Number(date.slice(-2))}
                                  </button>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>
          )}

          {selectedService && bookingDate && (
            <section
              ref={timeSectionRef}
              tabIndex={-1}
              className="space-y-4 focus:outline-none"
              aria-labelledby="booking-time-title"
            >
              <div>
                <h3 id="booking-time-title" className="text-base font-semibold text-main">
                  3. Elige una hora
                </h3>
                <p className="mt-1 text-sm text-subtle">
                  {formatDate(bookingDate)}
                  {selectedStaff
                    ? ` con ${selectedStaff.name}`
                    : ', con el primer profesional disponible'}
                  .
                </p>
              </div>
              {loadingSlots ? (
                <div className="booking-loading surface-soft rounded p-4" role="status">
                  Buscando horarios disponibles...
                </div>
              ) : slotError ? (
                <div
                  className="error-notice flex flex-wrap items-center gap-3 rounded p-3 text-sm"
                  role="alert"
                >
                  <span>{slotError}</span>
                  <button
                    type="button"
                    className="btn-outline px-3 py-1 text-sm"
                    onClick={refreshSlots}
                  >
                    Reintentar
                  </button>
                </div>
              ) : slots.length === 0 ? (
                <div className="surface-soft rounded p-4 text-sm">
                  <p className="font-semibold text-main">
                    No quedan horarios disponibles para esta fecha.
                  </p>
                  <p className="mt-1 text-subtle">
                    Prueba otro día o deja seleccionado cualquier profesional.
                  </p>
                  <button
                    type="button"
                    className="btn-outline mt-3 px-3 py-1 text-sm"
                    onClick={() =>
                      setCalendarMonth((month) => shiftMonth(month || minimumMonth, 1))
                    }
                    disabled={calendarMonth >= maximumMonth}
                  >
                    Ver otra fecha
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm text-subtle">
                    {availableSlotCount} horarios disponibles. Los horarios marcados no se pueden
                    seleccionar.
                  </p>
                  <p id="booking-unavailable-slot-hint" className="sr-only">
                    Horario no disponible para este agendamiento. Elige otra hora.
                  </p>
                  {(['Mañana', 'Tarde', 'Noche'] as const).map((period) =>
                    slotsByPeriod[period]?.length ? (
                      <div key={period}>
                        <h4 className="mb-2 text-sm font-semibold text-main">{period}</h4>
                        <div className="flex flex-wrap gap-2">
                          {slotsByPeriod[period].map((item) => (
                            <button
                              key={item.time}
                              type="button"
                              className={`booking-time min-h-11 ${item.available ? '' : 'is-unavailable'} ${slot?.time === item.time && slot.staffId === item.staffId ? 'is-selected' : ''}`}
                              aria-pressed={
                                item.available &&
                                slot?.time === item.time &&
                                slot.staffId === item.staffId
                              }
                              aria-label={`${formatTime(item.time)}${item.available ? '' : `. No disponible: ${item.unavailableReason}`}`}
                              aria-describedby={
                                item.available ? undefined : 'booking-unavailable-slot-hint'
                              }
                              title={item.available ? undefined : item.unavailableReason}
                              disabled={!item.available}
                              onClick={() => {
                                if (!item.available) return;
                                setSlot(item);
                                setSubmitError('');
                              }}
                            >
                              {formatTime(item.time)}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null,
                  )}
                </div>
              )}
            </section>
          )}

          {slot && selectedService && bookingDate && (
            <section className="space-y-4" aria-labelledby="booking-contact-title">
              {selectableProducts.length > 0 && (
                <fieldset className="space-y-3">
                  <div>
                    <legend className="text-base font-semibold text-main">
                      4. Productos <span className="font-normal text-subtle">(opcional)</span>
                    </legend>
                    <p className="mt-1 text-sm text-subtle">
                      Agrégalos a tu solicitud. El negocio confirmará disponibilidad y detalles
                      después.
                    </p>
                  </div>
                  <ul className="booking-product-list" aria-label="Productos disponibles">
                    {selectableProducts.map((product) => {
                      const quantity = requestedProductQuantities[product.id] || 0;
                      const description =
                        typeof product.description === 'string' && product.description.trim()
                          ? product.description.trim()
                          : 'Este producto aún no tiene una descripción disponible.';
                      return (
                        <li
                          key={product.id}
                          className={`booking-product-row ${quantity ? 'is-selected' : ''}`}
                        >
                          <BookingProductThumbnail product={product} />
                          <div className="booking-product-copy">
                            <h4>{product.name}</h4>
                            <p>{description}</p>
                            <strong>{formatPrice(product.price)}</strong>
                          </div>
                          <div
                            className="booking-product-quantity"
                            aria-label={`Cantidad de ${product.name}`}
                          >
                            <button
                              type="button"
                              className="btn-outline"
                              onClick={() => setProductQuantity(product.id, quantity - 1)}
                              disabled={quantity === 0}
                              aria-label={`Reducir cantidad de ${product.name}`}
                            >
                              −
                            </button>
                            <output
                              aria-live="polite"
                              aria-label={`${quantity} ${quantity === 1 ? 'unidad' : 'unidades'} de ${product.name}`}
                            >
                              {quantity}
                            </output>
                            <button
                              type="button"
                              className="btn-outline"
                              onClick={() => setProductQuantity(product.id, quantity + 1)}
                              disabled={quantity >= 10}
                              aria-label={`Aumentar cantidad de ${product.name}`}
                            >
                              +
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  {requestedProducts.length > 0 && (
                    <p className="booking-product-subtotal" role="status">
                      {requestedProductSubtotal > 0
                        ? `Subtotal estimado: ${formatPrice(requestedProductSubtotal)}.`
                        : 'Productos añadidos a la solicitud.'}{' '}
                      El negocio confirmará el total final.
                    </p>
                  )}
                </fieldset>
              )}
              <div>
                <h3 id="booking-contact-title" className="text-base font-semibold text-main">
                  {selectableProducts.length ? '5' : '4'}. Tus datos y confirmación
                </h3>
                <p className="mt-1 text-sm text-subtle">
                  Usaremos estos datos solo para gestionar tu solicitud.
                </p>
              </div>
              <div className="booking-confirmation-summary">
                <span>{selectedService.name}</span>
                <span>
                  {formatDate(bookingDate)} · {formatTime(slot.time)}
                </span>
                <span>
                  {staffId
                    ? staff.find((member) => member.id === slot.staffId)?.name
                    : 'El negocio asignará a tu profesional.'}
                </span>
              </div>
              {requestedProducts.length > 0 && (
                <p className="text-sm text-subtle">
                  Productos solicitados:{' '}
                  {requestedProducts
                    .map((product) => `${product.name} × ${product.quantity}`)
                    .join(', ')}
                  .
                </p>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="field-label text-sm">Nombre</span>
                  <input
                    className="field-input"
                    value={clientName}
                    maxLength={120}
                    onChange={(event) => setClientName(event.target.value)}
                    autoComplete="name"
                  />
                </label>
                <label className="space-y-1">
                  <span className="field-label text-sm">Celular</span>
                  <input
                    className="field-input opacity-50"
                    value={clientPhone}
                    maxLength={40}
                    onChange={(event) => setClientPhone(event.target.value)}
                    autoComplete="tel"
                    inputMode="tel"
                    placeholder="300 123 4567"
                    aria-describedby="phone-hint"
                    aria-invalid={Boolean(clientPhone) && (!phoneValid || !phoneLengthValid)}
                  />
                </label>
                {emailRequested && (
                  <label className="space-y-1">
                    <span className="field-label text-sm">
                      Correo electrónico{' '}
                      {customerFields?.email === 'required' ? (
                        <span aria-hidden="true">*</span>
                      ) : (
                        <span className="font-normal text-subtle">(opcional)</span>
                      )}
                    </span>
                    <input
                      className="field-input"
                      type="email"
                      value={clientEmail}
                      maxLength={254}
                      onChange={(event) => setClientEmail(event.target.value)}
                      autoComplete="email"
                      aria-required={customerFields?.email === 'required'}
                      aria-invalid={Boolean(emailValue) && !emailValid}
                    />
                  </label>
                )}
                {addressRequested && (
                  <label className="space-y-1">
                    <span className="field-label text-sm">
                      Dirección{' '}
                      {customerFields?.address === 'required' ? (
                        <span aria-hidden="true">*</span>
                      ) : (
                        <span className="font-normal text-subtle">(opcional)</span>
                      )}
                    </span>
                    <input
                      className="field-input"
                      value={clientAddress}
                      maxLength={240}
                      onChange={(event) => setClientAddress(event.target.value)}
                      autoComplete="street-address"
                      aria-required={customerFields?.address === 'required'}
                      aria-invalid={Boolean(addressValue) && !addressValid}
                    />
                  </label>
                )}
              </div>
              <label className="block space-y-1">
                <span className="field-label text-sm">
                  Nota para el negocio <span className="font-normal text-subtle">(opcional)</span>
                </span>
                <textarea
                  className="field-textarea min-h-24 opacity-50"
                  value={bookingNote}
                  maxLength={BOOKING_NOTE_MAX_LENGTH}
                  onChange={(event) => setBookingNote(event.target.value)}
                  placeholder="Ej.: prefiero cierto producto o color."
                  aria-describedby="booking-note-hint"
                  aria-invalid={!bookingNoteValid}
                />
                <span id="booking-note-hint" className="block text-xs text-subtle">
                  Comparte una solicitud para tu cita. Máximo {BOOKING_NOTE_MAX_LENGTH} caracteres.
                </span>
              </label>
              {requiresPrivacyAcceptance && (
                <label className="flex items-start gap-3 text-sm text-main">
                  <input
                    className="mt-1 h-4 w-4"
                    type="checkbox"
                    checked={consent}
                    onChange={(event) => setConsent(event.target.checked)}
                  />
                  <span>
                    Acepto que el negocio use mis datos para gestionar esta solicitud, conforme al{' '}
                    <a
                      className="accent-link font-semibold underline underline-offset-2"
                      href={`${import.meta.env.BASE_URL}tratamiento-de-datos`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      tratamiento de datos personales
                    </a>{' '}
                    y al{' '}
                    <a
                      className="accent-link font-semibold underline underline-offset-2"
                      href={`${import.meta.env.BASE_URL}privacidad`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      aviso de privacidad
                    </a>
                    .
                  </span>
                </label>
              )}
              {submitError && (
                <div className="error-notice rounded p-3 text-sm" role="alert">
                  {submitError}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="btn-primary px-4 py-2"
                  onClick={() => void submit()}
                  disabled={!canConfirm || submitting}
                >
                  {submitting ? 'Enviando solicitud...' : 'Enviar solicitud de agendamiento'}
                </button>
                {!canConfirm && !submitting && (
                  <button
                    type="button"
                    className="btn-outline px-4 py-2"
                    onClick={showValidationToast}
                    aria-describedby="booking-validation-help"
                  >
                    Revisar requisitos
                  </button>
                )}
                <p id="booking-validation-help" className="sr-only">
                  Muestra lo que falta antes de enviar la solicitud.
                </p>
                {whatsappUrl && (
                  <a
                    className="accent-link text-sm font-semibold text-main underline"
                    href={whatsappUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    ¿Prefieres escribir por WhatsApp?
                  </a>
                )}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
