import React, { useEffect, useRef, useState } from 'react';
import type { UploadTask } from 'firebase/storage';
import { getBarberManagedCollection, getBarberStatus, updateBarberPlanSettings } from '../../../lib/barbers';
import { saveBusinessDetails, validateBusinessBrandingImage } from '../../../lib/business-branding';
import type { Barber, BarberStaff, BillingCycle, Plan, PublicBusiness, SubscriptionStatus, UserRole } from '../../../lib/types';
import { BusinessLocationPicker } from '../business/BusinessLocationMap';
import { DEFAULT_CUSTOM_THEME_PALETTE, DEFAULT_PUBLIC_THEME_ID, PUBLIC_THEMES, resolvePublicThemeId, validateCustomThemePalette, type CustomThemePalette, type PresetPublicThemeId, type PublicThemeId } from '../../../lib/public-theme';
import { BILLING_CYCLE_LABEL, DATA, PLAN_LABEL } from '../../../lib/data';
import AgendaPanel from './AgendaPanel';
import BookingConfiguration from './BookingConfiguration';
import ContentManagement from './ContentManagement';
import OwnSchedulePanel from './OwnSchedulePanel';
import FancySelect, { type FancySelectOption } from '../FancySelect';
import { notifyError, notifySuccess } from '../FloatingNotifications';
import ProfessionalProfileForm from './ProfessionalProfileForm';
import BusinessStatisticsPanel from './BusinessStatisticsPanel';

type Business = Barber | PublicBusiness;
type Tab = 'agenda' | 'perfil' | 'horario' | 'negocio' | 'contenido' | 'reservas' | 'suscripcion' | 'estadisticas';
type BrandingSlot = 'logo' | 'cover';
type BusinessFormState = {
  name: string; businessType: Barber['businessType']; address: string; location?: Barber['config']['location']; phone: string;
  instagram: string; facebook: string; whatsapp: string; publicThemeId: PublicThemeId; customThemePalette: CustomThemePalette;
};

const PLAN_OPTIONS: FancySelectOption<string>[] = Object.values(DATA.PLAN).map((value) => ({ value, label: PLAN_LABEL[value] }));
const BILLING_OPTIONS: FancySelectOption<string>[] = Object.values(DATA.BILLING_CYCLE).map((value) => ({ value, label: BILLING_CYCLE_LABEL[value] }));
const SUBSCRIPTION_STATUS_OPTIONS: FancySelectOption<SubscriptionStatus>[] = [
  { value: 'active', label: 'Activada' },
  { value: 'trial', label: 'En prueba' },
  { value: 'disabled', label: 'Desactivada' },
];
const SUBSCRIPTION_STATUS_LABEL: Record<SubscriptionStatus, string> = {
  active: 'Activada',
  trial: 'En prueba',
  disabled: 'Desactivada',
};

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isFinite(date.getTime()) ? date : null;
  }
  const date = new Date(value as string | number);
  return Number.isFinite(date.getTime()) ? date : null;
}

function toDateInput(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseDateInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]) ? date : null;
}

function cycleMonths(cycle: BillingCycle): number {
  return cycle === DATA.BILLING_CYCLE.MONTH_3 ? 3 : cycle === DATA.BILLING_CYCLE.MONTH_12 ? 12 : 1;
}

function addMonthsClamped(date: Date, months: number): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), 1);
  result.setMonth(result.getMonth() + months + 1, 0);
  const lastDay = result.getDate();
  result.setDate(Math.min(date.getDate(), lastDay));
  return result;
}

/** Billing ranges are inclusive, so a one-month cycle from March 1 ends March 31. */
function getSubscriptionEndDate(startsAt: Date, billingCycle: BillingCycle): Date {
  const nextCycleStart = addMonthsClamped(startsAt, cycleMonths(billingCycle));
  nextCycleStart.setDate(nextCycleStart.getDate() - 1);
  return nextCycleStart;
}

function inferSubscriptionStart(endsAt: Date, billingCycle: BillingCycle): Date {
  const nextCycleStart = new Date(endsAt);
  nextCycleStart.setDate(nextCycleStart.getDate() + 1);
  return addMonthsClamped(nextCycleStart, -cycleMonths(billingCycle));
}

function getInitialSubscriptionStatus(business: Barber): SubscriptionStatus {
  return getBarberStatus(business);
}

function getInitialSubscriptionStart(business: Barber, billingCycle: BillingCycle): Date {
  return toDate(business.subscriptionStartsAt) || (!business.trialUsed ? toDate(business.trialStartedAt) : null) ||
    (toDate(business.planExpiresAt) ? inferSubscriptionStart(toDate(business.planExpiresAt)!, billingCycle) : null) || new Date();
}
export default function BusinessAdminPage({ business, role, staffId, userId, profileName, onBack, onRefresh }: { business: Business; role: UserRole; staffId?: string; userId: string; profileName?: string; onBack: () => void; onRefresh: () => void | Promise<void> }) {
  const global = role === DATA.USER_ROLE.SUPERADMIN;
  const hasOwnProfessionalProfile = Boolean(staffId);
  const [tab, setTab] = useState<Tab>('agenda');
  const [contentActivated, setContentActivated] = useState(false);
  const [staffNames, setStaffNames] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const isStaff = role === DATA.USER_ROLE.STAFF;
  const canManageOwnSchedule = isStaff || hasOwnProfessionalProfile;
  const [form, setForm] = useState<BusinessFormState>(() => ({ name: business.name, businessType: business.businessType, address: business.config.address || '', location: business.config.location, phone: business.config.phone || '', instagram: business.config.socialLinks?.instagram || '', facebook: business.config.socialLinks?.facebook || '', whatsapp: business.config.socialLinks?.whatsapp || '', publicThemeId: resolvePublicThemeId(business.config.theme?.id), customThemePalette: validateCustomThemePalette(business.config.theme?.palette).palette || DEFAULT_CUSTOM_THEME_PALETTE }));
  const full = business as Barber;
  const [plan, setPlan] = useState<Plan>(full.plan || DATA.PLAN.STANDARD);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>(full.billingCycle || DATA.BILLING_CYCLE.MONTH_1);
  const initialSubscriptionStatus = getInitialSubscriptionStatus(full);
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatus>(initialSubscriptionStatus);
  const [subscriptionStartsAt, setSubscriptionStartsAt] = useState(() => toDateInput(getInitialSubscriptionStart(full, billingCycle)));
  const [disableConfirmationPending, setDisableConfirmationPending] = useState(false);
  const subscriptionStartDate = parseDateInput(subscriptionStartsAt);
  const subscriptionEndDate = subscriptionStartDate ? getSubscriptionEndDate(subscriptionStartDate, billingCycle) : null;
  const tabs: Array<[Tab, string]> = isStaff ? [['agenda', 'Agenda'], ['perfil', 'Mi perfil profesional'], ['horario', 'Mi horario']] : [['agenda', 'Agenda'], ...(canManageOwnSchedule ? [['perfil', 'Mi perfil profesional'], ['horario', 'Mi horario']] as Array<[Tab, string]> : []), ['negocio', 'Negocio'], ['contenido', 'Contenido'], ['reservas', 'Agendamiento'], ...(global ? [['suscripcion', 'Suscripción']] as Array<[Tab, string]> : []), ['estadisticas', 'Estadísticas']];

  useEffect(() => { if (!hasOwnProfessionalProfile && tab === 'horario') setTab('agenda'); }, [hasOwnProfessionalProfile, tab]);
  useEffect(() => {
    if (isStaff) return;
    let cancelled = false;
    void getBarberManagedCollection<BarberStaff>(business.id, 'barbers').then((staff) => {
      if (cancelled) return;
      setStaffNames(Object.fromEntries(staff.flatMap((member) => {
        const name = member.name?.trim();
        return name ? [[member.id, name]] : [];
      })));
    });
    return () => { cancelled = true; };
  }, [business.id, isStaff]);
  const run = async (action: () => Promise<boolean>) => { setSaving(true); try { if (!await action()) throw new Error('No se pudo guardar el cambio.'); await onRefresh(); notifySuccess('Cambios guardados.'); } catch (cause) { notifyError(cause instanceof Error ? cause.message : 'No se pudo guardar el cambio.'); } finally { setSaving(false); } };
  const saveBusiness = (files: Record<BrandingSlot, File | null>, onProgress: (progress: Partial<Record<BrandingSlot, number>>) => void, onTask: (task: UploadTask | null) => void) => void run(async () => { await saveBusinessDetails(business.id, form, files, onProgress, onTask); return true; });
  const saveSubscription = () => {
    if (!subscriptionStartDate || !subscriptionEndDate) {
      notifyError('Indique una fecha de inicio válida para calcular el rango de activación.');
      return;
    }
    void run(() => updateBarberPlanSettings(business.id, plan, billingCycle, { status: subscriptionStatus, startsAt: subscriptionStartDate }));
  };

  return <main className="section-shell min-h-screen">
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-7 flex flex-wrap items-start justify-between gap-4"><div><button type="button" className="mb-3 text-sm font-semibold text-subtle hover:text-main" onClick={onBack}>← Cambiar negocio</button><p className="text-xs font-semibold uppercase tracking-widest text-subtle">Administración del negocio</p><h1 className="text-3xl font-bold text-main">{business.name}</h1><p className="mt-1 text-sm text-subtle">{isStaff ? 'Personal · agenda y horario personal' : global ? 'Superadministración · operación y controles globales' : 'Administración · operación del negocio'}</p></div><a href={`${import.meta.env.BASE_URL}b/${encodeURIComponent(business.slug)}`} className="btn-outline rounded-lg px-3 py-2 text-sm">Ver página</a></header>
      <nav className="mb-6 border-b" aria-label="Secciones de administración"><div className="flex gap-1 overflow-x-auto">{tabs.map(([key, label]) => <button key={key} type="button" aria-current={tab === key ? 'page' : undefined} onClick={() => { setTab(key); if (key === 'contenido') setContentActivated(true); }} className={`shrink-0 border-b-2 px-4 py-3 text-sm font-semibold ${tab === key ? 'border-(--secondary) text-(--secondary)' : 'border-transparent text-subtle'}`}>{label}</button>)}</div></nav>
      {tab === 'agenda' && <AgendaPanel businessId={business.id} staffId={isStaff ? staffId : undefined} claimStaffId={staffId} profileName={profileName} staffNames={staffNames} capacityConfirmationOnly={!isStaff && hasOwnProfessionalProfile} />}
      {tab === 'perfil' && staffId && <ProfessionalProfileForm businessId={business.id} uid={userId} role={isStaff ? 'staff' : 'storeadmin'} initialName={profileName} onChange={onRefresh} />}
      {canManageOwnSchedule && tab === 'horario' && staffId && <OwnSchedulePanel businessId={business.id} staffId={staffId} />}
      {tab === 'negocio' && <BusinessForm form={form} setForm={setForm} saving={saving} logoUrl={business.config.logoUrl} coverUrl={business.config.coverUrl} onSave={saveBusiness} />}
      {contentActivated && <div hidden={tab !== 'contenido'}><ContentManagement barberId={business.id} actorUid={userId} role={global ? 'superadmin' : 'storeadmin'} profileName={profileName} onChange={onRefresh} /></div>}
      {tab === 'reservas' && <BookingConfiguration business={business} />}
      {tab === 'estadisticas' && <BusinessStatisticsPanel businessId={business.id} />}
      {tab === 'suscripcion' && global && <section className="surface-card max-w-2xl rounded-2xl p-6" aria-labelledby="subscription-title"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="subscription-title" className="text-xl font-bold text-main">Suscripción</h2><p className="mt-1 max-w-prose text-sm text-subtle">Defina el estado, el plan y el periodo de activación de este negocio.</p></div><span className={`status-badge inline-flex rounded-full px-3 py-1 text-sm font-semibold ${subscriptionStatus === 'active' ? 'status-active' : subscriptionStatus === 'trial' ? 'status-trial' : 'status-inactive'}`}>Estado: {SUBSCRIPTION_STATUS_LABEL[subscriptionStatus]}</span></div><div className="mt-6 grid gap-4 md:grid-cols-2"><label className="field-label">Estado<FancySelect value={subscriptionStatus} options={SUBSCRIPTION_STATUS_OPTIONS} disabled={saving} onChange={(value) => { const nextStatus = value as SubscriptionStatus; setSubscriptionStatus(nextStatus); setDisableConfirmationPending(nextStatus === 'disabled' && initialSubscriptionStatus !== 'disabled'); }} /></label><label className="field-label">Plan<FancySelect value={plan} options={PLAN_OPTIONS} disabled={saving} onChange={(value) => setPlan(value as Plan)} /></label><label className="field-label">Ciclo de facturación<FancySelect value={billingCycle} options={BILLING_OPTIONS} disabled={saving} onChange={(value) => setBillingCycle(value as BillingCycle)} /></label><label className="field-label">Inicio de activación<input className="field-input mt-1" type="date" value={subscriptionStartsAt} disabled={saving} onChange={(event) => setSubscriptionStartsAt(event.target.value)} aria-describedby="subscription-range" /></label></div><div id="subscription-range" className="surface-soft mt-5 grid gap-1 rounded-lg p-4 sm:grid-cols-[minmax(9rem,auto)_1fr] sm:items-baseline"><p className="text-sm font-semibold text-main">Rango calculado</p><p className="text-sm text-subtle" aria-live="polite">{subscriptionStartDate && subscriptionEndDate ? `${subscriptionStartDate.toLocaleDateString('es-CO')} — ${subscriptionEndDate.toLocaleDateString('es-CO')}` : 'Ingrese una fecha de inicio válida.'}</p></div>{disableConfirmationPending && <div className="mt-5 border border-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_10%,var(--surface))] p-4" role="alert"><h3 className="font-semibold text-main">Confirmar desactivación</h3><p className="mt-1 text-sm text-subtle">La página pública y sus flujos disponibles dejarán de estar activos. El negocio y sus datos se conservarán.</p><div className="mt-4 flex flex-wrap gap-3"><button type="button" className="btn-outline rounded-lg px-4 py-2" disabled={saving} onClick={() => { setSubscriptionStatus(initialSubscriptionStatus); setDisableConfirmationPending(false); }}>Cancelar</button><button type="button" className="danger-action rounded-lg px-4 py-2 disabled:opacity-50" disabled={saving} onClick={saveSubscription}>{saving ? 'Desactivando...' : 'Confirmar desactivación'}</button></div></div>}<button type="button" disabled={saving || disableConfirmationPending} className="btn-primary mt-6 rounded-lg px-4 py-2 disabled:opacity-50" onClick={saveSubscription}>{saving ? 'Guardando...' : 'Guardar suscripción'}</button></section>}
    </div>
  </main>;
}

function LegacyBusinessForm({ form, setForm, saving, logoUrl, coverUrl, onSave, onThemeSelect }: { form: BusinessFormState; setForm: React.Dispatch<React.SetStateAction<BusinessFormState>>; saving: boolean; logoUrl?: string; coverUrl?: string; onSave: (files: Record<BrandingSlot, File | null>, onProgress: (progress: Partial<Record<BrandingSlot, number>>) => void, onTask: (task: UploadTask | null) => void) => void; onThemeSelect: (themeId: PublicThemeId) => void }) {
  const [files, setFiles] = useState<Record<BrandingSlot, File | null>>({ logo: null, cover: null });
  const [previews, setPreviews] = useState<Record<BrandingSlot, string>>({ logo: '', cover: '' });
  const [progress, setProgress] = useState<Partial<Record<BrandingSlot, number>>>({});
  const [imageError, setImageError] = useState('');
  const uploadTask = useRef<UploadTask | null>(null);
  useEffect(() => () => { uploadTask.current?.cancel(); Object.values(previews).forEach((url) => { if (url) URL.revokeObjectURL(url); }); }, [previews]);
  const chooseImage = (slot: BrandingSlot, file: File | null) => { if (!file) return; const error = validateBusinessBrandingImage(file); if (error) { setImageError(error); return; } setImageError(''); setFiles((current) => ({ ...current, [slot]: file })); setPreviews((current) => { if (current[slot]) URL.revokeObjectURL(current[slot]); return { ...current, [slot]: URL.createObjectURL(file) }; }); };
  const removeImage = (slot: BrandingSlot) => { setFiles((current) => ({ ...current, [slot]: null })); setPreviews((current) => { if (current[slot]) URL.revokeObjectURL(current[slot]); return { ...current, [slot]: '' }; }); };
  const save = () => { if (form.publicThemeId === 'custom') { const result = validateCustomThemePalette(form.customThemePalette); if (!result.palette) { notifyError(result.error || 'Revise los colores del tema personalizado.'); return; } } setProgress({}); onSave(files, setProgress, (task) => { uploadTask.current = task; }); };
  const field = (label: string, key: keyof Pick<BusinessFormState, 'name' | 'address' | 'phone' | 'instagram' | 'facebook' | 'whatsapp'>, hint?: string) => {
    return <div className={key === 'address' ? 'md:col-span-2' : undefined}><label className="field-label">{label}<input className="field-input mt-1" value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} />{hint && <span className="field-hint mt-1 block text-xs">{hint}</span>}</label>{key === 'address' && <BusinessLocationPicker value={form.location} onChange={(location) => setForm({ ...form, location })} />}</div>;
  };
  return <section className="surface-card max-w-4xl rounded-2xl p-6"><h2 className="text-xl font-bold text-main">Datos del negocio</h2><p className="mt-1 text-sm text-subtle">Personalice la página pública autónoma del negocio. La ubicación actual se muestra con el punto seleccionado en el mapa; la dirección es una referencia adicional.</p><div className="mt-6 grid gap-3 md:grid-cols-2">{field('Nombre', 'name')}{field('Dirección', 'address', 'Se muestra como referencia.')}{field('Teléfono', 'phone')}{field('Instagram', 'instagram')}{field('Facebook', 'facebook')}{field('WhatsApp', 'whatsapp')}</div><fieldset className="mt-8 border-t border-(--border) pt-6"><legend className="text-lg font-bold text-main">Tema de la página pública</legend><p className="mt-1 text-sm text-subtle">Elija un tema exclusivo para este negocio.</p><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{PUBLIC_THEMES.map((theme) => <button key={theme.id} type="button" className={`public-theme-choice ${form.publicThemeId === theme.id ? 'is-selected' : ''}`} aria-pressed={form.publicThemeId === theme.id} onClick={() => { onThemeSelect(theme.id); setForm({ ...form, publicThemeId: theme.id }); }}><span className="public-theme-swatches">{theme.swatches.map((color) => <span key={color} style={{ backgroundColor: color }} />)}</span><span><strong>{theme.name}</strong><small>{theme.mode === 'dark' ? 'Oscuro' : 'Claro'}</small></span></button>)}</div></fieldset><fieldset className="mt-8 border-t border-(--border) pt-6"><legend className="text-lg font-bold text-main">Logo y portada</legend><p className="mt-1 text-sm text-subtle">JPEG, PNG o WebP; máximo 5 MiB.</p><div className="mt-4 grid gap-4 md:grid-cols-2">{(['logo', 'cover'] as BrandingSlot[]).map((slot) => { const source = previews[slot] || (slot === 'logo' ? logoUrl : coverUrl); return <div key={slot} className="business-brand-image-picker"><p className="font-semibold text-main">{slot === 'logo' ? 'Logo' : 'Portada'}</p>{source ? <img src={source} alt={`Vista previa de ${slot === 'logo' ? 'logo' : 'portada'}`} className={`mt-3 ${slot === 'logo' ? 'business-brand-logo-preview' : 'business-brand-cover-preview'}`} /> : <div className={`mt-3 business-brand-image-empty ${slot === 'logo' ? 'business-brand-logo-preview' : 'business-brand-cover-preview'}`}>Sin imagen</div>}<label className="btn-outline mt-3 inline-flex cursor-pointer rounded-lg px-3 py-2 text-sm font-semibold">Seleccionar imagen<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => chooseImage(slot, event.target.files?.[0] || null)} /></label>{previews[slot] && <button type="button" className="ml-2 text-sm font-semibold text-subtle underline" onClick={() => removeImage(slot)}>Quitar selección</button>}{progress[slot] !== undefined && <p className="mt-2 text-sm text-subtle">Subiendo {progress[slot]}%</p>}</div>; })}</div>{imageError && <p className="error-message mt-3 text-sm" role="alert">{imageError}</p>} {saving && uploadTask.current && <button type="button" className="btn-outline mt-4 rounded-lg px-3 py-2 text-sm" onClick={() => uploadTask.current?.cancel()}>Cancelar carga</button>}</fieldset><button type="button" disabled={saving} className="btn-primary mt-6 rounded-lg px-4 py-2 disabled:opacity-50" onClick={save}>{saving ? 'Guardando...' : 'Guardar negocio'}</button></section>;
}

function BusinessForm(props: { form: BusinessFormState; setForm: React.Dispatch<React.SetStateAction<BusinessFormState>>; saving: boolean; logoUrl?: string; coverUrl?: string; onSave: (files: Record<BrandingSlot, File | null>, onProgress: (progress: Partial<Record<BrandingSlot, number>>) => void, onTask: (task: UploadTask | null) => void) => void }) {
  const [open, setOpen] = useState(false);
  const [presetBeforeCustom, setPresetBeforeCustom] = useState<PresetPublicThemeId>(props.form.publicThemeId === 'custom' ? DEFAULT_PUBLIC_THEME_ID : props.form.publicThemeId);
  const selectTheme = (themeId: PublicThemeId) => {
    if (themeId !== 'custom') return;
    if (props.form.publicThemeId !== 'custom') setPresetBeforeCustom(props.form.publicThemeId);
    setOpen(true);
  };
  return <><CustomThemePaletteDialog {...props} open={open} setOpen={setOpen} presetBeforeCustom={presetBeforeCustom} /><LegacyBusinessForm {...props} onThemeSelect={selectTheme} /></>;
}

function CustomThemePaletteDialog({ form, setForm, saving, open, setOpen, presetBeforeCustom }: Pick<Parameters<typeof BusinessForm>[0], 'form' | 'setForm' | 'saving'> & { open: boolean; setOpen: React.Dispatch<React.SetStateAction<boolean>>; presetBeforeCustom: PresetPublicThemeId }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  if (form.publicThemeId !== 'custom') return null;
  const validation = validateCustomThemePalette(form.customThemePalette);
  const isValid = Boolean(validation.palette);
  const fields: Array<[keyof CustomThemePalette, string, string]> = [
    ['background', 'Fondo', 'Color base de las áreas amplias.'],
    ['surface', 'Superficie', 'Color de paneles y formularios.'],
    ['text', 'Texto', 'Color del contenido legible.'],
    ['primary', 'Acción principal', 'Color de botones y acciones destacadas.'],
  ];
  const update = (key: keyof CustomThemePalette, value: string) => setForm({ ...form, customThemePalette: { ...form.customThemePalette, [key]: value } });
  const cancelCustomTheme = () => {
    setForm({ ...form, publicThemeId: presetBeforeCustom });
    setOpen(false);
  };
  return <dialog ref={dialogRef} className="custom-theme-dialog" aria-labelledby="custom-theme-title" onClose={() => setOpen(false)}>
      <div className="surface-card custom-theme-dialog-content">
        <div className="flex items-start justify-between gap-4"><div><h2 id="custom-theme-title" className="text-xl font-bold text-main">Tema personalizado</h2><p className="mt-1 text-sm text-subtle">Defina los cuatro colores. Guarde el formulario principal para aplicar los cambios.</p></div><button type="button" className="btn-outline px-3 py-2 text-sm" aria-label="Cerrar editor de colores" onClick={() => setOpen(false)}>Cerrar</button></div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {fields.map(([key, label, hint]) => <label key={key} className="theme-color-field"><span>{label}</span><span className="theme-color-inputs"><input type="color" value={/^#[0-9a-f]{6}$/i.test(form.customThemePalette[key]) ? form.customThemePalette[key] : '#000000'} disabled={saving} onChange={(event) => update(key, event.target.value)} aria-label={`Selector de color: ${label}`} /><input className="field-input" value={form.customThemePalette[key]} disabled={saving} onChange={(event) => update(key, event.target.value)} aria-describedby={`custom-theme-${key}-hint custom-theme-validation`} /></span><small id={`custom-theme-${key}-hint`}>{hint}</small></label>)}
        </div>
        <p id="custom-theme-validation" className={`mt-4 text-sm font-semibold ${validation.error ? 'text-danger' : 'text-success'}`} role={validation.error ? 'alert' : 'status'} aria-live={validation.error ? 'assertive' : 'polite'}>{validation.error || 'Paleta válida. Puede cerrar el editor y guardar el formulario principal.'}</p>
        <div className="mt-5 flex flex-wrap justify-end gap-3"><button type="button" className="btn-outline px-4 py-2 text-sm font-semibold" onClick={cancelCustomTheme} disabled={saving}>Cancelar</button><button type="button" className="btn-primary px-4 py-2 text-sm font-semibold" onClick={() => setOpen(false)} disabled={!isValid || saving}>Listo</button></div>
      </div>
  </dialog>;
}
