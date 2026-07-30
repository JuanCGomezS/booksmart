import React, { useEffect, useState } from 'react';
import { deleteBarber, toggleBarberActive, updateBarberBusinessDetails, updateBarberPlanSettings } from '../../../lib/barbers';
import type { Barber, BillingCycle, Plan, PublicBusiness, UserRole } from '../../../lib/types';
import { BILLING_CYCLE_LABEL, DATA, PLAN_LABEL } from '../../../lib/data';
import AgendaPanel from './AgendaPanel';
import BookingConfiguration from './BookingConfiguration';
import ContentManagement from './ContentManagement';
import OwnSchedulePanel from './OwnSchedulePanel';
import ConfirmModal from '../ConfirmModal';
import FancySelect, { type FancySelectOption } from '../FancySelect';
import { notifyError, notifySuccess } from '../FloatingNotifications';

type Business = Barber | PublicBusiness;
type Tab = 'agenda' | 'horario' | 'negocio' | 'contenido' | 'reservas' | 'suscripcion' | 'peligro';
const PLAN_OPTIONS: FancySelectOption<string>[] = Object.values(DATA.PLAN).map((value) => ({ value, label: PLAN_LABEL[value] }));
const BILLING_OPTIONS: FancySelectOption<string>[] = Object.values(DATA.BILLING_CYCLE).map((value) => ({ value, label: BILLING_CYCLE_LABEL[value] }));
const BUSINESS_DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const DEFAULT_WORKING_HOURS: Barber['workingHours'] = Object.fromEntries(Array.from({ length: 7 }, (_, day) => [day, { open: '09:00', close: '18:00', enabled: false }])) as Barber['workingHours'];
const VALID_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function getSafeWorkingHours(workingHours: unknown): { value: Barber['workingHours']; isComplete: boolean } {
  const source = workingHours && typeof workingHours === 'object' ? workingHours as Record<number, unknown> : {};
  let isComplete = true;
  const value = Object.fromEntries(Array.from({ length: 7 }, (_, day) => {
    const value = source[day];
    if (!value || typeof value !== 'object') {
      isComplete = false;
      return [day, DEFAULT_WORKING_HOURS[day]];
    }
    const schedule = value as Partial<Barber['workingHours'][number]>;
    if (typeof schedule.open !== 'string' || typeof schedule.close !== 'string' || !VALID_TIME.test(schedule.open) || !VALID_TIME.test(schedule.close) || schedule.open >= schedule.close) {
      isComplete = false;
      return [day, DEFAULT_WORKING_HOURS[day]];
    }
    return [day, {
      open: typeof schedule.open === 'string' ? schedule.open : DEFAULT_WORKING_HOURS[day].open,
      close: typeof schedule.close === 'string' ? schedule.close : DEFAULT_WORKING_HOURS[day].close,
      enabled: typeof schedule.enabled === 'boolean' ? schedule.enabled : DEFAULT_WORKING_HOURS[day].enabled,
    }];
  })) as Barber['workingHours'];
  return { value, isComplete };
}

type BusinessFormState = {
  name: string;
  businessType: Barber['businessType'];
  address: string;
  phone: string;
  logoUrl: string;
  coverUrl: string;
  instagram: string;
  facebook: string;
  whatsapp: string;
  primaryColor: string;
  workingHours: Barber['workingHours'];
};

export default function BusinessAdminPage({ business, role, staffId, onBack, onRefresh }: { business: Business; role: UserRole; staffId?: string; onBack: () => void; onRefresh: () => void | Promise<void> }) {
  const global = role === DATA.USER_ROLE.SUPERADMIN;
  const hasOwnProfessionalProfile = Boolean(staffId);
  const [tab, setTab] = useState<Tab>('agenda'); const [contentActivated, setContentActivated] = useState(false); const [saving, setSaving] = useState(false); const message: null = null; const [confirm, setConfirm] = useState<null | { title: string; text: string; dangerous?: boolean; run: () => Promise<void> }>(null);
  const isStaff = role === DATA.USER_ROLE.STAFF || (hasOwnProfessionalProfile && tab === 'horario');
  useEffect(() => { if (!hasOwnProfessionalProfile && tab === 'horario') setTab('agenda'); }, [hasOwnProfessionalProfile, tab]);
  const initialWorkingHours = getSafeWorkingHours(business.workingHours);
  const [workingHoursEdited, setWorkingHoursEdited] = useState(false);
  const [form, setForm] = useState(() => ({ name: business.name, businessType: business.businessType, address: business.config.address || '', phone: business.config.phone || '', logoUrl: business.config.logoUrl || '', coverUrl: business.config.coverUrl || '', instagram: business.config.socialLinks?.instagram || '', facebook: business.config.socialLinks?.facebook || '', whatsapp: business.config.socialLinks?.whatsapp || '', primaryColor: business.config.theme?.primaryColor || '#000000', workingHours: initialWorkingHours.value }));
  const full = business as Barber; const [plan, setPlan] = useState<Plan>(full.plan || DATA.PLAN.STANDARD); const [billingCycle, setBillingCycle] = useState<BillingCycle>(full.billingCycle || DATA.BILLING_CYCLE.MONTH_1);
  const tabs: Array<[Tab, string]> = isStaff ? [['agenda', 'Agenda'], ['horario', 'Mi horario']] : [['agenda', 'Agenda'], ...(hasOwnProfessionalProfile ? [['horario', 'Mi horario']] as Array<[Tab, string]> : []), ['negocio', 'Negocio'], ['contenido', 'Contenido'], ['reservas', 'Reservas'], ...(global ? [['suscripcion', 'Suscripción'], ['peligro', 'Peligro']] as Array<[Tab, string]> : [])];
  const run = async (action: () => Promise<boolean>) => { setSaving(true); try { if (!await action()) throw new Error('No se pudo guardar el cambio.'); await onRefresh(); notifySuccess('Cambios guardados.'); } catch (cause) { notifyError(cause instanceof Error ? cause.message : 'No se pudo guardar el cambio.'); } finally { setSaving(false); } };
  return <main className="section-shell min-h-screen"><div className="mx-auto max-w-6xl px-4 py-8"><header className="mb-7 flex flex-wrap items-start justify-between gap-4"><div><button type="button" className="mb-3 text-sm font-semibold text-subtle hover:text-main" onClick={onBack}>← Cambiar negocio</button><p className="text-xs font-semibold uppercase tracking-widest text-subtle">Administración del negocio</p><h1 className="text-3xl font-bold text-main">{business.name}</h1><p className="mt-1 text-sm text-subtle">{isStaff ? 'Personal · agenda y horario propio' : global ? 'Superadministración · operación y controles globales' : 'Storeadmin · operación del negocio'}</p></div><a href={`${import.meta.env.BASE_URL}b/${encodeURIComponent(business.slug)}`} className="btn-outline rounded-lg px-3 py-2 text-sm">Ver página pública</a></header><nav className="mb-6 border-b" aria-label="Secciones de administración"><div role="tablist" className="flex gap-1 overflow-x-auto">{tabs.map(([key, label]) => <button key={key} role="tab" type="button" aria-selected={tab === key} onClick={() => { setTab(key); if (key === 'contenido') setContentActivated(true); }} className={`shrink-0 border-b-2 px-4 py-3 text-sm font-semibold ${tab === key ? 'border-(--secondary) text-(--secondary)' : 'border-transparent text-subtle'}`}>{label}</button>)}</div></nav>{message && <p className="mb-4 rounded-lg p-3 text-sm surface-soft">{message}</p>}{tab === 'agenda' && <AgendaPanel businessId={business.id} staffId={isStaff ? staffId : undefined} />}{isStaff && tab === 'horario' && staffId && <OwnSchedulePanel businessId={business.id} staffId={staffId} />}{tab === 'negocio' && <BusinessForm form={form} setForm={setForm} saving={saving} onWorkingHoursChange={() => setWorkingHoursEdited(true)} onSave={() => void run(() => updateBarberBusinessDetails(business.id, { ...form, workingHours: initialWorkingHours.isComplete || workingHoursEdited ? form.workingHours : undefined }))} />}{contentActivated && <div hidden={tab !== 'contenido'}><ContentManagement barberId={business.id} onChange={onRefresh} /></div>}{tab === 'reservas' && <BookingConfiguration business={business} />}{global && tab === 'suscripcion' && <section className="surface-card max-w-2xl space-y-4 rounded-2xl p-6"><h2 className="text-xl font-bold text-main">Plan y estado</h2><FancySelect value={plan} options={PLAN_OPTIONS} onChange={(value) => setPlan(value as Plan)} /><FancySelect value={billingCycle} options={BILLING_OPTIONS} onChange={(value) => setBillingCycle(value as BillingCycle)} /><button type="button" disabled={saving} className="btn-primary rounded-lg px-4 py-2 disabled:opacity-50" onClick={() => setConfirm({ title: 'Actualizar suscripción', text: `Aplicar ${PLAN_LABEL[plan]} a ${business.name}.`, run: async () => run(() => updateBarberPlanSettings(business.id, plan, billingCycle)) })}>Guardar suscripción</button><button type="button" disabled={saving} className="btn-outline ml-3 rounded-lg px-4 py-2" onClick={() => setConfirm({ title: business.active ? 'Desactivar negocio' : 'Activar negocio', text: `¿Confirmás este cambio para ${business.name}?`, run: async () => run(() => toggleBarberActive(business.id, !business.active)) })}>{business.active ? 'Desactivar' : 'Activar'}</button></section>}{global && tab === 'peligro' && <section className="max-w-2xl rounded-xl border p-5"><h2 className="text-xl font-bold text-main">Zona de peligro</h2><p className="mt-2 text-sm text-subtle">Eliminar el documento principal no elimina automáticamente sus subcolecciones.</p><button type="button" className="mt-4 rounded-lg bg-red-700 px-4 py-2 text-white" onClick={() => setConfirm({ title: 'Eliminar negocio', text: `¿Eliminar ${business.name}? Esta acción no se puede deshacer.`, dangerous: true, run: async () => { await run(() => deleteBarber(business.id)); onBack(); } })}>Eliminar negocio</button></section>}</div><ConfirmModal isOpen={Boolean(confirm)} title={confirm?.title || ''} message={confirm?.text || ''} isDangerous={confirm?.dangerous} confirmText="Confirmar" cancelText="Cancelar" onConfirm={() => { if (confirm) void confirm.run().then(() => setConfirm(null)); }} onCancel={() => setConfirm(null)} /></main>;
}
function BusinessForm({ form, setForm, saving, onWorkingHoursChange, onSave }: { form: BusinessFormState; setForm: React.Dispatch<React.SetStateAction<BusinessFormState>>; saving: boolean; onWorkingHoursChange: () => void; onSave: () => void }) {
  const updateWorkingDay = (day: number, changes: Partial<Barber['workingHours'][number]>) => {
    const current = form.workingHours[day] || { open: '09:00', close: '18:00', enabled: false };
    setForm({ ...form, workingHours: { ...form.workingHours, [day]: { ...current, ...changes } } });
    onWorkingHoursChange();
  };
  const save = () => {
    if (invalidWorkingDays.some(Boolean)) {
      notifyError('En los días activos, la hora de apertura debe ser anterior a la de cierre.');
      return;
    }
    onSave();
  };
  const invalidWorkingDays = BUSINESS_DAYS.map((_, day) => {
    const current = form.workingHours[day];
    return current?.enabled && (!VALID_TIME.test(current.open) || !VALID_TIME.test(current.close) || current.open >= current.close);
  });

  return <section className="surface-card max-w-3xl rounded-2xl p-6">
    <h2 className="mb-4 text-xl font-bold text-main">Datos del negocio</h2>
    <div className="grid gap-3 md:grid-cols-2">{[['Nombre', 'name'], ['Dirección', 'address'], ['Teléfono', 'phone'], ['Logo URL', 'logoUrl'], ['Portada URL', 'coverUrl'], ['Instagram', 'instagram'], ['Facebook', 'facebook'], ['WhatsApp', 'whatsapp']].map(([label, key]) => <label key={key} className="field-label">{label}<input className="field-input mt-1" value={form[key as keyof BusinessFormState] as string} onChange={(event) => setForm({ ...form, [key]: event.target.value })} /></label>)}</div>
    <fieldset className="mt-8 border-t border-(--border) pt-6">
      <legend className="text-lg font-bold text-main">Horario de atención</legend>
       <p className="mt-1 text-sm text-subtle">El horario del negocio limita las reservas. El personal puede tener una disponibilidad más restringida.</p>
      <div className="mt-5 space-y-2">{BUSINESS_DAYS.map((day, index) => {
        const current = form.workingHours[index] || { open: '09:00', close: '18:00', enabled: false };
         const invalid = Boolean(invalidWorkingDays[index]);
         const errorId = `working-hours-${index}-error`;
         return <div key={day} className={`surface-soft grid gap-3 rounded-lg p-3 sm:grid-cols-[minmax(9rem,1fr)_minmax(0,1fr)_minmax(0,1fr)] sm:items-center ${invalid ? 'border-[var(--danger)]' : ''}`}>
            <label className="flex min-h-10 items-center gap-2 text-sm font-semibold text-main"><input type="checkbox" checked={current.enabled} onChange={(event) => updateWorkingDay(index, { enabled: event.target.checked })} />{day}</label>
            <label className="grid gap-1 text-xs font-semibold text-subtle">Apertura<input className="field-input" type="time" disabled={!current.enabled} value={current.open} aria-invalid={invalid || undefined} aria-describedby={invalid ? errorId : undefined} onChange={(event) => updateWorkingDay(index, { open: event.target.value })} /></label>
            <label className="grid gap-1 text-xs font-semibold text-subtle">Cierre<input className="field-input" type="time" disabled={!current.enabled} value={current.close} aria-invalid={invalid || undefined} aria-describedby={invalid ? errorId : undefined} onChange={(event) => updateWorkingDay(index, { close: event.target.value })} /></label>
            {invalid && <p id={errorId} className="sr-only">La hora de apertura debe ser anterior a la de cierre.</p>}
          </div>;
      })}</div>
    </fieldset>
    <button type="button" disabled={saving} className="btn-primary mt-6 rounded-lg px-4 py-2 disabled:opacity-50" onClick={save}>{saving ? 'Guardando...' : 'Guardar negocio'}</button>
  </section>;
}
