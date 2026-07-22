import React, { useEffect, useState } from 'react';
import {
  deleteBarber,
  getBarberMetrics,
  toggleBarberActive,
  updateBarberBusinessDetails,
  updateBarberPlanSettings,
} from '../../../lib/barbers';
import type { Barber, BarberMetrics, BarberStaff, BillingCycle, CatalogItem, Plan, Product, Service } from '../../../lib/types';
import { BILLING_CYCLE_LABEL, DATA, PLAN_LABEL } from '../../../lib/data';
import ConfirmModal from '../ConfirmModal';
import FancySelect, { type FancySelectOption } from '../FancySelect';
import BookingConfiguration from './BookingConfiguration';
import ContentManagement from './ContentManagement';

interface BarberManagementModalProps {
  barber: Barber;
  onClose: () => void;
  onRefresh: () => void;
}

type Tab = 'resumen' | 'negocio' | 'contenido' | 'reservas' | 'suscripcion' | 'peligro';
type CollectionName = 'catalog' | 'products' | 'services' | 'barbers';
interface Confirmation {
  title: string;
  message: string;
  dangerous?: boolean;
  action: () => Promise<void>;
}

const TAB_LABELS: Record<Tab, string> = {
  resumen: 'Resumen',
  negocio: 'Negocio',
  contenido: 'Contenido',
  reservas: 'Reservas',
  suscripcion: 'Suscripción',
  peligro: 'Peligro',
};
const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const PLAN_OPTIONS: FancySelectOption<string>[] = Object.values(DATA.PLAN).map((value) => ({ value, label: PLAN_LABEL[value] }));
const BILLING_OPTIONS: FancySelectOption<string>[] = Object.values(DATA.BILLING_CYCLE).map((value) => ({ value, label: BILLING_CYCLE_LABEL[value] }));

const dateForInput = (value: unknown) => {
  if (!value) return '';
  const date = value instanceof Date ? value : (value as { toDate?: () => Date }).toDate?.() || new Date(value as string);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
};

export default function BarberManagementModal({ barber, onClose, onRefresh }: BarberManagementModalProps) {
  const [tab, setTab] = useState<Tab>('resumen');
  const [contentActivated, setContentActivated] = useState(false);
  const [metrics, setMetrics] = useState<BarberMetrics | null>(null);
  const [loadingMetrics, setLoadingMetrics] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [business, setBusiness] = useState(() => ({
    name: barber.name,
    businessType: barber.businessType,
    address: barber.config?.address || '',
    phone: barber.config?.phone || '',
    logoUrl: barber.config?.logoUrl || '',
    coverUrl: barber.config?.coverUrl || '',
    instagram: barber.config?.socialLinks?.instagram || '',
    facebook: barber.config?.socialLinks?.facebook || '',
    whatsapp: barber.config?.socialLinks?.whatsapp || '',
    primaryColor: barber.config?.theme?.primaryColor || '#000000',
  }));
  const [hours, setHours] = useState(() => Object.fromEntries(DAYS.map((_, day) => [day, barber.workingHours?.[day] || { open: '09:00', close: '18:00', enabled: false }])) as Barber['workingHours']);
  const [plan, setPlan] = useState<Plan>(barber.plan);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>(barber.billingCycle);
  const [planExpiresAt, setPlanExpiresAt] = useState(dateForInput(barber.planExpiresAt));

  const loadMetrics = async () => {
    setLoadingMetrics(true);
    setMetrics(await getBarberMetrics(barber.id));
    setLoadingMetrics(false);
  };

  useEffect(() => { loadMetrics(); }, [barber.id]);

  const run = async (action: () => Promise<boolean>, successMessage?: string): Promise<boolean> => {
    setSaving(true);
    setError('');
    try {
      if (!await action()) throw new Error('No se pudo guardar el cambio.');
      if (successMessage) setError(successMessage);
      onRefresh();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar el cambio.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveBusiness = () => run(() => updateBarberBusinessDetails(barber.id, { ...business, workingHours: hours }));

  const savePlan = () => setConfirmation({
    title: 'Actualizar suscripción',
    message: `¿Aplicar el plan ${PLAN_LABEL[plan]} a ${barber.name}? Esto también activa el negocio.`,
    action: async () => { await run(() => updateBarberPlanSettings(barber.id, plan, billingCycle, planExpiresAt ? new Date(`${planExpiresAt}T23:59:59`) : undefined)); },
  });

  const saveConfirmation = async () => {
    if (!confirmation) return;
    await confirmation.action();
    setConfirmation(null);
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        <div className="surface-card flex h-[calc(100dvh-1.5rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl shadow-2xl sm:h-[calc(100dvh-3rem)]">
          <header className="flex shrink-0 items-start justify-between gap-4 border-b p-4 sm:p-6" style={{ borderColor: 'var(--border)' }}>
            <div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-widest text-subtle">Centro de administración</p><h2 className="truncate text-xl font-bold text-main sm:text-2xl">{barber.name}</h2><p className="text-sm text-subtle">/b/{barber.slug}</p></div>
            <button type="button" onClick={onClose} className="btn-outline shrink-0 rounded-lg px-3 py-2 text-sm" aria-label="Cerrar administración">Cerrar</button>
          </header>
          <nav className="shrink-0 border-b bg-(--surface) px-4 pt-3 sm:px-6" aria-label="Secciones de administración" style={{ borderColor: 'var(--border)' }}>
            <div role="tablist" className="flex gap-1 overflow-x-auto">
              {(Object.keys(TAB_LABELS) as Tab[]).map((key) => (
                <button
                  key={key}
                  id={`barber-tab-${key}`}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  aria-controls={`barber-panel-${key}`}
                  onClick={() => { setTab(key); if (key === 'contenido') setContentActivated(true); }}
                  className={`shrink-0 border-b-2 px-4 py-3 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-(--secondary) focus-visible:ring-offset-2 ${tab === key ? 'border-(--secondary) text-(--secondary)' : 'border-transparent text-subtle hover:border-(--border) hover:text-main'}`}
                >
                  {TAB_LABELS[key]}
                </button>
              ))}
            </div>
          </nav>
          <div id={`barber-panel-${tab}`} role="tabpanel" aria-labelledby={`barber-tab-${tab}`} className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
            {error && <p className="mb-4 rounded-lg p-3 text-sm" style={{ background: 'color-mix(in srgb, #ef4444 14%, var(--surface))', color: '#fecaca' }}>{error}</p>}
            {tab === 'resumen' && <Summary metrics={metrics} loading={loadingMetrics} onRefresh={loadMetrics} />}
            {tab === 'negocio' && <section className="space-y-6"><h3 className="text-lg font-bold text-main">Datos del negocio y horario</h3><div className="grid gap-4 md:grid-cols-2"><Field label="Nombre"><input className="field-input" value={business.name} onChange={(e) => setBusiness({ ...business, name: e.target.value })} /></Field><Field label="Dirección"><input className="field-input" value={business.address} onChange={(e) => setBusiness({ ...business, address: e.target.value })} /></Field><Field label="Teléfono"><input className="field-input" value={business.phone} onChange={(e) => setBusiness({ ...business, phone: e.target.value })} /></Field><Field label="Color principal"><input type="color" className="field-input h-11 p-1" value={business.primaryColor} onChange={(e) => setBusiness({ ...business, primaryColor: e.target.value })} /></Field><Field label="URL del logo"><input type="url" className="field-input" value={business.logoUrl} onChange={(e) => setBusiness({ ...business, logoUrl: e.target.value })} /></Field><Field label="URL de portada"><input type="url" className="field-input" value={business.coverUrl} onChange={(e) => setBusiness({ ...business, coverUrl: e.target.value })} /></Field><Field label="Instagram"><input className="field-input" value={business.instagram} onChange={(e) => setBusiness({ ...business, instagram: e.target.value })} /></Field><Field label="Facebook"><input className="field-input" value={business.facebook} onChange={(e) => setBusiness({ ...business, facebook: e.target.value })} /></Field><Field label="WhatsApp"><input className="field-input" value={business.whatsapp} onChange={(e) => setBusiness({ ...business, whatsapp: e.target.value })} /></Field></div><div><h4 className="mb-3 font-semibold text-main">Horario de atención</h4><div className="space-y-2">{DAYS.map((day, index) => <div key={day} className="surface-soft grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-lg p-3 sm:grid-cols-[1fr_auto_auto_auto]"><label className="flex items-center gap-2 text-sm text-main"><input type="checkbox" checked={hours[index].enabled} onChange={(e) => setHours({ ...hours, [index]: { ...hours[index], enabled: e.target.checked } })} />{day}</label><input aria-label={`Apertura ${day}`} type="time" className="field-input w-25 p-2" value={hours[index].open} disabled={!hours[index].enabled} onChange={(e) => setHours({ ...hours, [index]: { ...hours[index], open: e.target.value } })} /><span className="hidden text-subtle sm:block">a</span><input aria-label={`Cierre ${day}`} type="time" className="field-input w-25 p-2" value={hours[index].close} disabled={!hours[index].enabled} onChange={(e) => setHours({ ...hours, [index]: { ...hours[index], close: e.target.value } })} /></div>)}</div></div><button type="button" disabled={saving || !business.name.trim()} onClick={saveBusiness} className="btn-primary rounded-xl px-5 py-2 font-semibold disabled:opacity-50">Guardar negocio</button></section>}
            {contentActivated && <div hidden={tab !== 'contenido'}><ContentManagement barberId={barber.id} onChange={loadMetrics} /></div>}
            {tab === 'reservas' && <BookingConfiguration barber={barber} />}
            {tab === 'suscripcion' && <section className="max-w-2xl space-y-5"><h3 className="text-lg font-bold text-main">Plan y estado</h3><p className="text-sm text-subtle">El cambio de plan activa el negocio y marca el período de prueba como utilizado.</p><Field label="Plan"><FancySelect value={plan} onChange={(value) => setPlan(value as Plan)} options={PLAN_OPTIONS} /></Field><Field label="Ciclo de facturación"><FancySelect value={billingCycle} onChange={(value) => setBillingCycle(value as BillingCycle)} options={BILLING_OPTIONS} /></Field><Field label="Vencimiento"><input type="date" className="field-input" value={planExpiresAt} onChange={(e) => setPlanExpiresAt(e.target.value)} /></Field><button type="button" disabled={saving} onClick={savePlan} className="btn-primary rounded-xl px-5 py-2 font-semibold disabled:opacity-50">Guardar suscripción</button><div className="surface-soft flex flex-wrap items-center justify-between gap-3 rounded-xl p-4"><div><p className="font-semibold text-main">Acceso del negocio</p><p className="text-sm text-subtle">Actualmente está {barber.active ? 'activo' : 'desactivado'}.</p></div><button type="button" disabled={saving} onClick={() => setConfirmation({ title: barber.active ? 'Desactivar negocio' : 'Activar negocio', message: `¿${barber.active ? 'Desactivar' : 'Activar'} ${barber.name}?`, action: async () => { await run(() => toggleBarberActive(barber.id, !barber.active)); } })} className="btn-outline rounded-xl px-4 py-2 text-sm font-semibold">{barber.active ? 'Desactivar' : 'Activar'}</button></div></section>}
            {tab === 'peligro' && <section className="max-w-2xl rounded-xl border p-5" style={{ borderColor: 'color-mix(in srgb, #ef4444 55%, var(--border))' }}><h3 className="text-lg font-bold" style={{ color: '#fca5a5' }}>Zona de peligro</h3><p className="mt-2 text-sm text-subtle">Eliminar borra físicamente el documento del negocio. Las subcolecciones existentes no se eliminan automáticamente con Firestore.</p><button type="button" disabled={saving} onClick={() => setConfirmation({ title: 'Eliminar negocio', message: `¿Eliminar físicamente "${barber.name}"? Esta acción no se puede deshacer y puede dejar datos en subcolecciones.`, dangerous: true, action: async () => { if (await run(() => deleteBarber(barber.id))) onClose(); } })} className="mt-5 rounded-xl px-5 py-2 font-semibold text-white disabled:opacity-50" style={{ background: '#b91c1c' }}>Eliminar negocio</button></section>}
          </div>
        </div>
      </div>
      <ConfirmModal isOpen={Boolean(confirmation)} title={confirmation?.title || ''} message={confirmation?.message || ''} isDangerous={confirmation?.dangerous} confirmText="Confirmar" cancelText="Cancelar" onConfirm={saveConfirmation} onCancel={() => setConfirmation(null)} />
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="field-label mb-1 block text-sm font-medium">{label}</span>{children}</label>; }
function Summary({ metrics, loading, onRefresh }: { metrics: BarberMetrics | null; loading: boolean; onRefresh: () => void }) { const cards = metrics ? [['Citas del mes', metrics.appointmentsThisMonth], ['Productos activos', metrics.activeProducts], ['Profesionales activos', metrics.activeBarbers], ['Ítems de catálogo', metrics.totalCatalogItems]] : []; return <section><div className="mb-4 flex items-center justify-between"><div><h3 className="text-lg font-bold text-main">Métricas básicas</h3><p className="text-sm text-subtle">Actividad del negocio seleccionado.</p></div><button type="button" className="btn-outline rounded-lg px-3 py-2 text-sm" onClick={onRefresh} disabled={loading}>{loading ? 'Cargando...' : 'Actualizar'}</button></div>{!loading && !metrics ? <p className="text-sm text-subtle">No fue posible cargar métricas.</p> : <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{cards.map(([label, value]) => <div key={String(label)} className="surface-soft rounded-xl p-4"><p className="text-xs text-subtle">{label}</p><p className="text-2xl font-bold text-main">{value}</p></div>)}</div>}</section>; }

interface ContentManagerProps { catalog: CatalogItem[]; products: Product[]; services: Service[]; staff: BarberStaff[]; loading: boolean; catalogForm: { title: string; imageUrl: string; tags: string }; productForm: { name: string; description: string; price: string; stock: string; imageUrl: string; active: boolean }; serviceForm: { name: string; description: string; duration: string; price: string; imageUrl: string }; staffForm: { name: string; role: string; photoUrl: string; active: boolean }; setCatalogForm: React.Dispatch<React.SetStateAction<ContentManagerProps['catalogForm']>>; setProductForm: React.Dispatch<React.SetStateAction<ContentManagerProps['productForm']>>; setServiceForm: React.Dispatch<React.SetStateAction<ContentManagerProps['serviceForm']>>; setStaffForm: React.Dispatch<React.SetStateAction<ContentManagerProps['staffForm']>>; onCatalog: () => void; onProduct: () => void; onService: () => void; onStaff: () => void; onDelete: (collection: CollectionName, id: string, label: string) => void; onToggle: (collection: CollectionName, id: string, active: boolean) => void; onEdit: (collection: CollectionName, id: string, data: Record<string, unknown>) => void; }
function ContentManager(props: ContentManagerProps) { if (props.loading) return <p className="text-subtle">Cargando contenido...</p>; const edit = (collection: CollectionName, item: { id: string }, label: string, data: Record<string, unknown>) => { const value = window.prompt(`Editar ${label}`, String(data[label] || '')); if (value !== null && value.trim()) props.onEdit(collection, item.id, { [label]: value.trim() }); }; return <section className="space-y-8"><div><h3 className="text-lg font-bold text-main">Galería y catálogo</h3><div className="mt-3 grid gap-3 md:grid-cols-3"><input className="field-input" placeholder="Título" value={props.catalogForm.title} onChange={(e) => props.setCatalogForm({ ...props.catalogForm, title: e.target.value })} /><input className="field-input" placeholder="URL de imagen" value={props.catalogForm.imageUrl} onChange={(e) => props.setCatalogForm({ ...props.catalogForm, imageUrl: e.target.value })} /><input className="field-input" placeholder="Etiquetas separadas por coma" value={props.catalogForm.tags} onChange={(e) => props.setCatalogForm({ ...props.catalogForm, tags: e.target.value })} /></div><button type="button" className="btn-primary mt-3 rounded-lg px-4 py-2 text-sm font-semibold" disabled={!props.catalogForm.title || !props.catalogForm.imageUrl} onClick={props.onCatalog}>Agregar foto</button><RecordList items={props.catalog} empty="No hay fotos publicadas." render={(item) => <><span>{item.title}</span><span className="text-subtle">{item.tags?.join(', ')}</span></>} onEdit={(item) => edit('catalog', item, 'title', { title: item.title })} onDelete={(item) => props.onDelete('catalog', item.id, item.title)} /></div><div><h3 className="text-lg font-bold text-main">Productos</h3><div className="mt-3 grid gap-3 md:grid-cols-3"><input className="field-input" placeholder="Nombre" value={props.productForm.name} onChange={(e) => props.setProductForm({ ...props.productForm, name: e.target.value })} /><input className="field-input" placeholder="Descripción" value={props.productForm.description} onChange={(e) => props.setProductForm({ ...props.productForm, description: e.target.value })} /><input type="number" min="0" step="0.01" className="field-input" placeholder="Precio" value={props.productForm.price} onChange={(e) => props.setProductForm({ ...props.productForm, price: e.target.value })} /><input type="number" min="0" className="field-input" placeholder="Stock" value={props.productForm.stock} onChange={(e) => props.setProductForm({ ...props.productForm, stock: e.target.value })} /><input className="field-input" placeholder="URL de imagen (opcional)" value={props.productForm.imageUrl} onChange={(e) => props.setProductForm({ ...props.productForm, imageUrl: e.target.value })} /><label className="field-label flex items-center gap-2 text-sm"><input type="checkbox" checked={props.productForm.active} onChange={(e) => props.setProductForm({ ...props.productForm, active: e.target.checked })} />Activo</label></div><button type="button" className="btn-primary mt-3 rounded-lg px-4 py-2 text-sm font-semibold" disabled={!props.productForm.name || !props.productForm.price} onClick={props.onProduct}>Agregar producto</button><RecordList items={props.products} empty="No hay productos." render={(item) => <><span>{item.name} · ${item.price}</span><button type="button" className="btn-outline rounded px-2 py-1 text-xs" onClick={() => props.onToggle('products', item.id, item.active)}>{item.active ? 'Desactivar' : 'Activar'}</button></>} onEdit={(item) => edit('products', item, 'name', { name: item.name })} onDelete={(item) => props.onDelete('products', item.id, item.name)} /></div><div><h3 className="text-lg font-bold text-main">Servicios</h3><div className="mt-3 grid gap-3 md:grid-cols-3"><input className="field-input" placeholder="Nombre" value={props.serviceForm.name} onChange={(e) => props.setServiceForm({ ...props.serviceForm, name: e.target.value })} /><input className="field-input" placeholder="Descripción" value={props.serviceForm.description} onChange={(e) => props.setServiceForm({ ...props.serviceForm, description: e.target.value })} /><input type="number" min="1" className="field-input" placeholder="Duración (minutos)" value={props.serviceForm.duration} onChange={(e) => props.setServiceForm({ ...props.serviceForm, duration: e.target.value })} /><input type="number" min="0" step="0.01" className="field-input" placeholder="Precio" value={props.serviceForm.price} onChange={(e) => props.setServiceForm({ ...props.serviceForm, price: e.target.value })} /><input className="field-input" placeholder="URL de imagen (opcional)" value={props.serviceForm.imageUrl} onChange={(e) => props.setServiceForm({ ...props.serviceForm, imageUrl: e.target.value })} /></div><button type="button" className="btn-primary mt-3 rounded-lg px-4 py-2 text-sm font-semibold" disabled={!props.serviceForm.name || !props.serviceForm.duration || !props.serviceForm.price} onClick={props.onService}>Agregar servicio</button><RecordList items={props.services} empty="No hay servicios." render={(item) => <span>{item.name} · {item.duration} min · ${item.price}</span>} onEdit={(item) => edit('services', item, 'name', { name: item.name })} onDelete={(item) => props.onDelete('services', item.id, item.name)} /></div><div><h3 className="text-lg font-bold text-main">Personal</h3><div className="mt-3 grid gap-3 md:grid-cols-3"><input className="field-input" placeholder="Nombre" value={props.staffForm.name} onChange={(e) => props.setStaffForm({ ...props.staffForm, name: e.target.value })} /><input className="field-input" placeholder="Rol" value={props.staffForm.role} onChange={(e) => props.setStaffForm({ ...props.staffForm, role: e.target.value })} /><input className="field-input" placeholder="URL de foto (opcional)" value={props.staffForm.photoUrl} onChange={(e) => props.setStaffForm({ ...props.staffForm, photoUrl: e.target.value })} /><label className="field-label flex items-center gap-2 text-sm"><input type="checkbox" checked={props.staffForm.active} onChange={(e) => props.setStaffForm({ ...props.staffForm, active: e.target.checked })} />Activo</label></div><button type="button" className="btn-primary mt-3 rounded-lg px-4 py-2 text-sm font-semibold" disabled={!props.staffForm.name} onClick={props.onStaff}>Agregar integrante</button><RecordList items={props.staff} empty="No hay integrantes." render={(item) => <><span>{item.name}{item.role ? ` · ${item.role}` : ''}</span><button type="button" className="btn-outline rounded px-2 py-1 text-xs" onClick={() => props.onToggle('barbers', item.id, item.active)}>{item.active ? 'Desactivar' : 'Activar'}</button></>} onEdit={(item) => edit('barbers', item, 'name', { name: item.name })} onDelete={(item) => props.onDelete('barbers', item.id, item.name)} /></div></section>; }
function RecordList<T extends { id: string }>({ items, empty, render, onEdit, onDelete }: { items: T[]; empty: string; render: (item: T) => React.ReactNode; onEdit: (item: T) => void; onDelete: (item: T) => void }) { return <div className="mt-3 space-y-2">{items.length === 0 ? <p className="text-sm text-subtle">{empty}</p> : items.map((item) => <div key={item.id} className="surface-soft flex flex-wrap items-center justify-between gap-2 rounded-lg p-3 text-sm text-main"><div className="flex flex-wrap items-center gap-2">{render(item)}</div><div className="flex gap-2"><button type="button" onClick={() => onEdit(item)} className="btn-outline rounded px-2 py-1 text-xs">Editar</button><button type="button" onClick={() => onDelete(item)} className="rounded px-2 py-1 text-xs" style={{ color: '#fca5a5', border: '1px solid color-mix(in srgb, #ef4444 45%, var(--border))' }}>Eliminar</button></div></div>)}</div>; }
