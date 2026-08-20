import React, { useEffect, useRef, useState } from 'react';
import type { UploadTask } from 'firebase/storage';
import {
  allocateContentRecordId,
  CONTENT_DESCRIPTION_MAX_LENGTH,
  createContentRecord,
  deleteContentRecord,
  getContentCollection,
  replaceContentImage,
  updateContentRecord,
  validateContentImage,
  type ContentCollection,
  type ContentRecord,
} from '../../../lib/content';
import type { BarberStaff, CatalogItem, Product, Service } from '../../../lib/types';
import {
  beginLazyResourceLoad,
  emptyLazyResource,
  rejectLazyResource,
  resolveLazyResource,
  type LazyResourceState,
} from '../../../lib/lazy-resource';
import {
  formatStaffEnrollmentCode,
  getStaffEnrollmentCode,
  rotateStaffEnrollmentCode,
  setEnrollmentStaffStatus,
} from '../../../lib/staff-enrollment';
import { notifyError } from '../FloatingNotifications';
import ConfirmModal from '../ConfirmModal';
import ProfessionalProfileForm from './ProfessionalProfileForm';

type ContentTab = 'gallery' | 'products' | 'services' | 'staff';
type ResourceState<T> = LazyResourceState<T>;
type UploadState = { progress: number; error: string };
type PendingCreate = { recordId: string; task: UploadTask | null; inFlight: boolean };

const emptyResource = emptyLazyResource;
function useImageSelection() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [inputKey, setInputKey] = useState(0);
  const previewRef = useRef('');

  const clear = () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = '';
    setPreviewUrl('');
    setFile(null);
    setInputKey((key) => key + 1);
  };

  const select = (nextFile: File | null) => {
    clear();
    if (!nextFile) return '';
    const error = validateContentImage(nextFile);
    if (error) return error;
    const nextPreview = URL.createObjectURL(nextFile);
    previewRef.current = nextPreview;
    setPreviewUrl(nextPreview);
    setFile(nextFile);
    return '';
  };

  useEffect(() => clear, []);
  return { file, previewUrl, select, clear, inputKey };
}

function ImagePicker({
  selection,
  label = 'Seleccionar imagen',
}: {
  selection: ReturnType<typeof useImageSelection>;
  label?: string;
}) {
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const reset = () => {
    selection.clear();
    setError('');
    if (inputRef.current) inputRef.current.value = '';
  };
  return (
    <div className="space-y-2">
      <label className="btn-outline inline-flex cursor-pointer rounded-lg px-3 py-2 text-sm font-semibold">
        {label}
        <input
          key={selection.inputKey}
          ref={inputRef}
          className="sr-only"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(event) => {
            const nextError = selection.select(event.target.files?.[0] || null);
            setError(nextError);
            if (nextError || !event.target.files?.[0]) event.target.value = '';
          }}
        />
      </label>
      {selection.previewUrl && (
        <div
          className="relative aspect-square w-28 overflow-hidden rounded-lg border"
          style={{ borderColor: 'var(--border)' }}
        >
          <img
            src={selection.previewUrl}
            alt="Vista previa de la imagen seleccionada"
            className="h-full w-full object-cover"
          />
          <button
            type="button"
            className="absolute right-1 top-1 rounded bg-black/70 px-2 py-1 text-xs text-white"
            onClick={reset}
          >
            Quitar
          </button>
        </div>
      )}
      {error && <p className="error-message text-sm">{error}</p>}
    </div>
  );
}

function useContentCreateMutation(barberId: string, collectionName: ContentCollection) {
  const pendingRef = useRef<PendingCreate | null>(null);
  const mountedRef = useRef(true);
  const [inFlight, setInFlight] = useState(false);

  useEffect(
    () => () => {
      mountedRef.current = false;
      pendingRef.current?.task?.cancel();
    },
    [],
  );

  const run = async (
    save: (recordId: string, onTask: (task: UploadTask | null) => void) => Promise<void>,
  ) => {
    if (pendingRef.current?.inFlight) return false;
    const pending = pendingRef.current || {
      recordId: allocateContentRecordId(barberId, collectionName),
      task: null,
      inFlight: false,
    };
    pending.inFlight = true;
    pendingRef.current = pending;
    setInFlight(true);
    try {
      await save(pending.recordId, (task) => {
        if (pendingRef.current === pending) pending.task = task;
      });
      pendingRef.current = null;
      return true;
    } finally {
      pending.inFlight = false;
      if (mountedRef.current) setInFlight(false);
    }
  };

  const cancel = () => pendingRef.current?.task?.cancel();
  return { inFlight, run, cancel };
}

export default function ContentManagement({
  barberId,
  actorUid,
  role,
  profileName,
  onChange,
}: {
  barberId: string;
  actorUid: string;
  role: 'storeadmin' | 'superadmin';
  profileName?: string;
  onChange: () => void;
}) {
  const [tab, setTab] = useState<ContentTab>('gallery');
  const [gallery, setGallery] = useState<ResourceState<CatalogItem>>(emptyResource);
  const [products, setProducts] = useState<ResourceState<Product>>(emptyResource);
  const [services, setServices] = useState<ResourceState<Service>>(emptyResource);
  const [staff, setStaff] = useState<ResourceState<BarberStaff>>(emptyResource);

  const load = async (collectionName: ContentCollection, force = false) => {
    const resources = {
      catalog: [gallery, setGallery],
      products: [products, setProducts],
      services: [services, setServices],
      barbers: [staff, setStaff],
    } as const;
    const [current, setter] = resources[collectionName];
    const loadingState = beginLazyResourceLoad(current as ResourceState<ContentRecord>, force);
    if (!loadingState) return;
    setter(loadingState as never);
    try {
      const data = await getContentCollection(barberId, collectionName);
      setter(resolveLazyResource(data as ContentRecord[]) as never);
    } catch (error) {
      setter(rejectLazyResource(loadingState, error) as never);
    }
  };

  useEffect(() => {
    if (tab === 'gallery') void load('catalog');
    if (tab === 'products') void load('products');
    if (tab === 'services') void load('services');
    if (tab === 'staff') void load('barbers');
  }, [tab]); // The loaded flag prevents a second Firestore read during this modal session.

  const tabs: Array<[ContentTab, string]> = [
    ['gallery', 'Galería'],
    ['products', 'Productos'],
    ['services', 'Servicios'],
    ['staff', 'Personal'],
  ];
  return (
    <section className="business-admin-content-management grid gap-6 md:grid-cols-[11rem_minmax(0,1fr)]">
      <nav
        aria-label="Secciones de contenido"
        className="business-admin-content-tabs flex gap-1 overflow-x-auto md:flex-col md:overflow-visible"
      >
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-current={tab === key ? 'page' : undefined}
            onClick={() => setTab(key)}
            className={`business-admin-content-tab shrink-0 rounded-lg border-l-2 px-4 py-3 text-left text-sm font-semibold ${tab === key ? 'is-active border-(--secondary) bg-(--surface) text-main' : 'border-transparent text-subtle hover:bg-(--surface)'}`}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="min-w-0">
        {tab === 'gallery' && (
          <GalleryPanel
            barberId={barberId}
            state={gallery}
            reload={() => load('catalog', true)}
            onChange={onChange}
          />
        )}
        {tab === 'products' && (
          <ProductsPanel
            barberId={barberId}
            state={products}
            reload={() => load('products', true)}
            onChange={onChange}
          />
        )}
        {tab === 'services' && (
          <ServicesPanel
            barberId={barberId}
            state={services}
            reload={() => load('services', true)}
            onChange={onChange}
          />
        )}
        {tab === 'staff' && (
          <StaffPanel
            barberId={barberId}
            actorUid={actorUid}
            role={role}
            profileName={profileName}
            state={staff}
            reload={() => load('barbers', true)}
            onChange={onChange}
          />
        )}
      </div>
    </section>
  );
}

function ResourceMessage({
  loading,
  error,
  retry,
}: {
  loading: boolean;
  error: string;
  retry: () => void;
}) {
  if (loading) return <p className="text-sm text-subtle">Cargando contenido...</p>;
  if (error)
    return (
      <div className="error-notice rounded-lg p-3 text-sm">
        {error}
        <button type="button" className="ml-3 underline" onClick={retry}>
          Reintentar
        </button>
      </div>
    );
  return null;
}

function GalleryPanel({
  barberId,
  state,
  reload,
  onChange,
}: {
  barberId: string;
  state: ResourceState<CatalogItem>;
  reload: () => void;
  onChange: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [upload, setUpload] = useState<UploadState>({ progress: 0, error: '' });
  const selection = useImageSelection();
  const mutation = useContentCreateMutation(barberId, 'catalog');
  const save = async () => {
    if (mutation.inFlight) return;
    if (!title.trim() || !selection.file)
      return setUpload({ progress: 0, error: 'Ingrese un título y seleccione una imagen.' });
    setUpload({ progress: 0, error: '' });
    try {
      const saved = await mutation.run(async (recordId, onUploadTask) => {
        await createContentRecord(
          barberId,
          'catalog',
          {
            title: title.trim(),
            ...(description.trim() ? { description: description.trim() } : {}),
            tags: tags
              .split(',')
              .map((tag) => tag.trim())
              .filter(Boolean),
          },
          selection.file,
          (progress) => setUpload({ progress, error: '' }),
          { recordId, onUploadTask },
        );
      });
      if (!saved) return;
      setTitle('');
      setDescription('');
      setTags('');
      selection.clear();
      setUpload({ progress: 0, error: '' });
      await reload();
      onChange();
    } catch (error) {
      setUpload((value) => ({
        ...value,
        error:
          error instanceof Error && error.message.includes('canceled')
            ? 'Carga cancelada. Puede intentarlo de nuevo.'
            : error instanceof Error
              ? error.message
              : 'No se pudo guardar la imagen.',
      }));
    }
  };
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-bold text-main">Galería</h3>
        <p className="mt-1 text-sm text-subtle">Muestra a tus clientes tu talento.</p>
      </div>
      <div className="surface-soft grid gap-3 rounded-xl p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <input
            className="field-input"
            placeholder="Título"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <input
            className="field-input"
            placeholder="Etiquetas separadas por coma"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
          />
          <textarea
            className="field-input md:col-span-2"
            aria-label="Descripción opcional"
            placeholder="Descripción (opcional)"
            maxLength={CONTENT_DESCRIPTION_MAX_LENGTH}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          <ImagePicker selection={selection} />
          {upload.progress > 0 && (
            <p className="text-sm text-subtle">Subiendo: {upload.progress}%</p>
          )}
          {upload.error && (
            <p className="error-message text-sm">
              {upload.error}{' '}
              <button type="button" className="underline" onClick={save}>
                Reintentar
              </button>
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
            disabled={state.loading || mutation.inFlight}
            onClick={save}
          >
            {mutation.inFlight ? 'Guardando...' : 'Guardar'}
          </button>
          {mutation.inFlight && (
            <button
              type="button"
              className="btn-outline rounded-lg px-4 py-2 text-sm font-semibold"
              onClick={mutation.cancel}
            >
              Cancelar carga
            </button>
          )}
        </div>
      </div>
      <ResourceMessage loading={state.loading} error={state.error} retry={reload} />
      <ContentList
        collectionName="catalog"
        barberId={barberId}
        items={state.data}
        reload={reload}
        onChange={onChange}
      />
    </div>
  );
}

function ProductsPanel({
  barberId,
  state,
  reload,
  onChange,
}: {
  barberId: string;
  state: ResourceState<Product>;
  reload: () => void;
  onChange: () => void;
}) {
  const [form, setForm] = useState({
    name: '',
    description: '',
    price: '',
    stock: '',
    active: true,
  });
  const [upload, setUpload] = useState<UploadState>({ progress: 0, error: '' });
  const selection = useImageSelection();
  const mutation = useContentCreateMutation(barberId, 'products');
  const save = async () => {
    if (mutation.inFlight) return;
    if (!form.name.trim() || !form.price)
      return setUpload({ progress: 0, error: 'Ingrese el nombre y el precio del producto.' });
    setUpload({ progress: 0, error: '' });
    try {
      const saved = await mutation.run(async (recordId, onUploadTask) => {
        await createContentRecord(
          barberId,
          'products',
          {
            name: form.name.trim(),
            ...(form.description.trim() ? { description: form.description.trim() } : {}),
            price: Number(form.price),
            stock: Number(form.stock || 0),
            active: form.active,
          },
          selection.file,
          (progress) => setUpload({ progress, error: '' }),
          { recordId, onUploadTask },
        );
      });
      if (!saved) return;
      setForm({ name: '', description: '', price: '', stock: '', active: true });
      selection.clear();
      setUpload({ progress: 0, error: '' });
      await reload();
      onChange();
    } catch (error) {
      setUpload((value) => ({
        ...value,
        error:
          error instanceof Error && error.message.includes('canceled')
            ? 'Carga cancelada. Puede intentarlo de nuevo.'
            : error instanceof Error
              ? error.message
              : 'No se pudo guardar el producto.',
      }));
    }
  };
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-bold text-main">Productos</h3>
        <p className="mt-1 text-sm text-subtle">
          La imagen y la descripción son opcionales; al cargarla se guarda junto al producto.
        </p>
      </div>
      <div className="surface-soft grid gap-3 rounded-xl p-4 md:grid-cols-2">
        <input
          className="field-input"
          placeholder="Nombre"
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
        />
        <textarea
          className="field-input"
          aria-label="Descripción opcional"
          placeholder="Descripción (opcional)"
          maxLength={CONTENT_DESCRIPTION_MAX_LENGTH}
          value={form.description}
          onChange={(event) => setForm({ ...form, description: event.target.value })}
        />
        <input
          type="number"
          min="0"
          className="field-input"
          placeholder="Precio"
          value={form.price}
          onChange={(event) => setForm({ ...form, price: event.target.value })}
        />
        <input
          type="number"
          min="0"
          className="field-input"
          placeholder="Inventario"
          value={form.stock}
          onChange={(event) => setForm({ ...form, stock: event.target.value })}
        />
        <label className="flex items-center gap-2 text-sm text-main">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(event) => setForm({ ...form, active: event.target.checked })}
          />
          Producto activo
        </label>
        <ImagePicker selection={selection} />
        {upload.progress > 0 && <p className="text-sm text-subtle">Subiendo: {upload.progress}%</p>}
        {upload.error && (
          <p className="error-message text-sm">
            {upload.error}{' '}
            <button type="button" className="underline" onClick={save}>
              Reintentar
            </button>
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
            disabled={state.loading || mutation.inFlight}
            onClick={save}
          >
            {mutation.inFlight ? 'Guardando...' : 'Guardar'}
          </button>
          {mutation.inFlight && selection.file && (
            <button
              type="button"
              className="btn-outline rounded-lg px-4 py-2 text-sm font-semibold"
              onClick={mutation.cancel}
            >
              Cancelar carga
            </button>
          )}
        </div>
      </div>
      <ResourceMessage loading={state.loading} error={state.error} retry={reload} />
      <ContentList
        collectionName="products"
        barberId={barberId}
        items={state.data}
        reload={reload}
        onChange={onChange}
      />
    </div>
  );
}

function ServicesPanel({
  barberId,
  state,
  reload,
  onChange,
}: {
  barberId: string;
  state: ResourceState<Service>;
  reload: () => void;
  onChange: () => void;
}) {
  const [form, setForm] = useState({
    name: '',
    description: '',
    price: '',
    duration: '',
    active: true,
  });
  const [upload, setUpload] = useState<UploadState>({ progress: 0, error: '' });
  const selection = useImageSelection();
  const mutation = useContentCreateMutation(barberId, 'services');
  const save = async () => {
    if (mutation.inFlight) return;
    if (
      !form.name.trim() ||
      !form.price ||
      !form.duration ||
      Number(form.price) < 0 ||
      Number(form.duration) <= 0
    )
      return setUpload({
        progress: 0,
        error: 'Ingrese nombre, precio y una duración válida para el servicio.',
      });
    setUpload({ progress: 0, error: '' });
    try {
      const saved = await mutation.run(async (recordId, onUploadTask) => {
        await createContentRecord(
          barberId,
          'services',
          {
            name: form.name.trim(),
            description: form.description.trim(),
            price: Number(form.price),
            duration: Number(form.duration),
            active: form.active,
          },
          selection.file,
          (progress) => setUpload({ progress, error: '' }),
          { recordId, onUploadTask },
        );
      });
      if (!saved) return;
      setForm({ name: '', description: '', price: '', duration: '', active: true });
      selection.clear();
      setUpload({ progress: 0, error: '' });
      await reload();
      onChange();
    } catch (error) {
      setUpload((value) => ({
        ...value,
        error:
          error instanceof Error && error.message.includes('canceled')
            ? 'Carga cancelada. Puede intentarlo de nuevo.'
            : error instanceof Error
              ? error.message
              : 'No se pudo guardar el servicio.',
      }));
    }
  };
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-bold text-main">Servicios</h3>
        <p className="mt-1 text-sm text-subtle">
          Defina la información comercial del servicio. La compatibilidad y los márgenes de tiempo
          se configuran exclusivamente en Agendamiento.
        </p>
      </div>
      <div className="surface-soft grid gap-3 rounded-xl p-4 md:grid-cols-2">
        <input
          className="field-input"
          placeholder="Nombre"
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
        />
        <input
          className="field-input"
          placeholder="Descripción"
          value={form.description}
          onChange={(event) => setForm({ ...form, description: event.target.value })}
        />
        <input
          type="number"
          min="0"
          className="field-input"
          placeholder="Precio"
          value={form.price}
          onChange={(event) => setForm({ ...form, price: event.target.value })}
        />
        <input
          type="number"
          min="1"
          className="field-input"
          placeholder="Duración (minutos)"
          value={form.duration}
          onChange={(event) => setForm({ ...form, duration: event.target.value })}
        />
        <label className="flex items-center gap-2 text-sm text-main">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(event) => setForm({ ...form, active: event.target.checked })}
          />
          Servicio activo
        </label>
        <ImagePicker selection={selection} />
        {upload.progress > 0 && <p className="text-sm text-subtle">Subiendo: {upload.progress}%</p>}
        {upload.error && (
          <p className="error-message text-sm">
            {upload.error}{' '}
            <button type="button" className="underline" onClick={save}>
              Reintentar
            </button>
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
            disabled={state.loading || mutation.inFlight}
            onClick={save}
          >
            {mutation.inFlight ? 'Guardando...' : 'Agregar servicio'}
          </button>
          {mutation.inFlight && selection.file && (
            <button
              type="button"
              className="btn-outline rounded-lg px-4 py-2 text-sm font-semibold"
              onClick={mutation.cancel}
            >
              Cancelar carga
            </button>
          )}
        </div>
      </div>
      <ResourceMessage loading={state.loading} error={state.error} retry={reload} />
      <ContentList
        collectionName="services"
        barberId={barberId}
        items={state.data}
        reload={reload}
        onChange={onChange}
      />
    </div>
  );
}

function StaffPanel({
  barberId,
  actorUid,
  role,
  profileName,
  state,
  reload,
  onChange,
}: {
  barberId: string;
  actorUid: string;
  role: 'storeadmin' | 'superadmin';
  profileName?: string;
  state: ResourceState<BarberStaff>;
  reload: () => void;
  onChange: () => void;
}) {
  const ownProfile = state.data.find((member) => member.id === actorUid) || null;
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-bold text-main">Personal</h3>
        <p className="mt-1 text-sm text-subtle">
          Administra la activación y el retiro del personal. Cada profesional completa únicamente su
          propio perfil; horarios y compatibilidad se gestionan en Agendamiento.
        </p>
      </div>
      {role === 'storeadmin' && (
        <ProfessionalProfileForm
          businessId={barberId}
          uid={actorUid}
          role="storeadmin"
          profile={ownProfile}
          initialName={profileName}
          onChange={async () => {
            await reload();
            onChange();
          }}
        />
      )}
      <DirectEnrollmentControls barberId={barberId} staff={state.data} reload={reload} />
      <ResourceMessage loading={state.loading} error={state.error} retry={reload} />
      <ContentList
        collectionName="barbers"
        barberId={barberId}
        items={state.data}
        reload={reload}
        onChange={onChange}
      />
    </div>
  );
}

function DirectEnrollmentControls({
  barberId,
  staff,
  reload,
}: {
  barberId: string;
  staff: BarberStaff[];
  reload: () => void;
}) {
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    void getStaffEnrollmentCode(barberId)
      .then(setCode)
      .catch(() => setError('No fue posible cargar el código del negocio.'));
  }, [barberId]);
  const rotate = async () => {
    setSaving(true);
    try {
      setCode(await rotateStaffEnrollmentCode(barberId));
    } catch {
      notifyError('No fue posible actualizar el código del negocio.');
    } finally {
      setSaving(false);
    }
  };
  const changeStatus = async (staffId: string, status: 'active' | 'inactive') => {
    setSaving(true);
    try {
      await setEnrollmentStaffStatus(barberId, staffId, status);
      await reload();
    } catch {
      notifyError('No fue posible actualizar el acceso del personal.');
    } finally {
      setSaving(false);
    }
  };
  const accounts = staff.filter((member) => member.accountStatus);
  return (
    <section className="surface-soft rounded-xl p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="font-semibold text-main">Código del negocio</h4>
          <p className="mt-1 text-sm text-subtle">
            Compártelo solo con la persona que se unirá a tu negocio.
          </p>
          {code && (
            <output className="mt-3 block select-all font-semibold tracking-wider text-main">
              {formatStaffEnrollmentCode(code)}
            </output>
          )}
        </div>
        <button
          type="button"
          className="btn-outline rounded px-3 py-2 text-sm"
          disabled={saving}
          onClick={() => void rotate()}
        >
          {code ? 'Regenerar código' : 'Generar código'}
        </button>
      </div>
      {error && (
        <p className="error-message mt-3 text-sm" role="alert">
          {error}
        </p>
      )}
      <div className="mt-6 border-t pt-4">
        <h4 className="font-semibold text-main">Personal con cuenta</h4>
        <p className="mt-1 text-sm text-subtle">
          Las cuentas nuevas aparecen inactivas. Actívalas para permitir el acceso operativo.
        </p>
        <div className="mt-3 space-y-2">
          {accounts.length === 0 ? (
            <p className="text-sm text-subtle">Todavía no hay personal con cuenta vinculada.</p>
          ) : (
            accounts.map((member) => (
              <div
                key={member.id}
                className="flex flex-wrap items-center justify-between gap-3 border-t pt-3"
              >
                <div>
                  <p className="font-medium text-main">{member.name}</p>
                  <p className="text-xs text-subtle">
                    {member.accountStatus === 'active' ? 'Acceso activo' : 'Acceso inactivo'}
                  </p>
                </div>
                <button
                  type="button"
                  className={
                    member.accountStatus === 'active'
                      ? 'btn-outline rounded px-3 py-2 text-sm disabled:opacity-50'
                      : 'btn-primary rounded px-3 py-2 text-sm disabled:opacity-50'
                  }
                  disabled={saving}
                  onClick={() =>
                    void changeStatus(
                      member.id,
                      member.accountStatus === 'active' ? 'inactive' : 'active',
                    )
                  }
                >
                  {member.accountStatus === 'active' ? 'Desactivar' : 'Activar'}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function ContentList<T extends ContentRecord>({
  collectionName,
  barberId,
  items,
  reload,
  onChange,
}: {
  collectionName: ContentCollection;
  barberId: string;
  items: T[];
  reload: () => void;
  onChange: () => void;
}) {
  const [itemPendingDeletion, setItemPendingDeletion] = useState<T | null>(null);
  const remove = async (item: T) => {
    try {
      await deleteContentRecord(barberId, collectionName, item);
      await reload();
      onChange();
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'No se pudo eliminar el registro.');
    }
  };
  const pendingLabel =
    itemPendingDeletion &&
    ('title' in itemPendingDeletion ? itemPendingDeletion.title : itemPendingDeletion.name);
  return (
    <>
      <div className="space-y-3">
        {items.length === 0 ? (
          <p className="text-sm text-subtle">Todavía no hay registros.</p>
        ) : (
          items.map((item) => (
            <ContentRow
              key={item.id}
              collectionName={collectionName}
              barberId={barberId}
              item={item}
              onDelete={() => setItemPendingDeletion(item)}
              onChange={async () => {
                await reload();
                onChange();
              }}
            />
          ))
        )}
      </div>
      {itemPendingDeletion && (
        <ConfirmModal
          isOpen
          title={`Eliminar ${pendingLabel}`}
          message="Esta acción eliminará el registro y no se puede deshacer."
          confirmText="Eliminar"
          isDangerous
          onCancel={() => setItemPendingDeletion(null)}
          onConfirm={() => {
            const item = itemPendingDeletion;
            setItemPendingDeletion(null);
            void remove(item);
          }}
        />
      )}
    </>
  );
}

function RetireProfessionalControl({
  barberId,
  member,
  onChange,
}: {
  barberId: string;
  member: BarberStaff;
  onChange: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [retiring, setRetiring] = useState(false);
  const [cleanupError, setCleanupError] = useState('');
  const confirmationHeadingRef = useRef<HTMLHeadingElement>(null);
  const retireButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirming) confirmationHeadingRef.current?.focus();
  }, [confirming]);
  const cancel = () => {
    setConfirming(false);
    requestAnimationFrame(() => retireButtonRef.current?.focus());
  };
  const pendingCleanupPaths = Array.isArray(member.pendingImageCleanupPaths)
    ? member.pendingImageCleanupPaths.filter((path): path is string => typeof path === 'string')
    : [];
  const isRetiredUnlinked = !member.active && !member.accountUid && !member.accountStatus;
  const retire = async () => {
    setRetiring(true);
    try {
      const { retireProfessional } = await import('../../../lib/staff-enrollment');
      await retireProfessional(barberId, member.id);
      await onChange();
      setConfirming(false);
    } catch (cause) {
      notifyError(
        cause instanceof Error ? cause.message : 'No fue posible retirar el perfil profesional.',
      );
    } finally {
      setRetiring(false);
    }
  };
  const retryCleanup = async () => {
    setRetiring(true);
    setCleanupError('');
    try {
      const { retryRetiredProfessionalPhotoCleanup } =
        await import('../../../lib/staff-enrollment');
      await retryRetiredProfessionalPhotoCleanup(barberId, member.id);
      await onChange();
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : 'No fue posible completar la limpieza de fotos.';
      setCleanupError(message);
      notifyError(message);
    } finally {
      setRetiring(false);
    }
  };
  if (isRetiredUnlinked) {
    if (pendingCleanupPaths.length === 0) return null;
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-[var(--danger)]" role="alert">
          Hay{' '}
          {pendingCleanupPaths.length === 1
            ? 'una foto pendiente'
            : `${pendingCleanupPaths.length} fotos pendientes`}{' '}
          de limpieza.
        </p>
        <button
          type="button"
          className="btn-outline content-row-action"
          disabled={retiring}
          onClick={() => void retryCleanup()}
        >
          {retiring ? 'Limpiando…' : 'Reintentar limpieza de fotos'}
        </button>
        {cleanupError && (
          <p className="w-full text-xs text-[var(--danger)]" role="alert">
            {cleanupError}
          </p>
        )}
      </div>
    );
  }
  return confirming ? (
    <div className="flex flex-wrap items-center gap-2">
      <h5 ref={confirmationHeadingRef} tabIndex={-1} className="text-xs font-semibold text-main">
        ¿Retirar a {member.name}? Se conservará su historial.
      </h5>
      <button
        type="button"
        className="danger-action content-row-action"
        disabled={retiring}
        onClick={() => void retire()}
      >
        {retiring ? 'Retirando…' : 'Confirmar retiro'}
      </button>
      <button
        type="button"
        className="btn-outline content-row-action"
        disabled={retiring}
        onClick={cancel}
      >
        Cancelar
      </button>
    </div>
  ) : (
    <button
      ref={retireButtonRef}
      type="button"
      className="danger-action content-row-action"
      onClick={() => setConfirming(true)}
    >
      Retirar
    </button>
  );
}

function ContentRow({
  collectionName,
  barberId,
  item,
  onDelete,
  onChange,
}: {
  collectionName: ContentCollection;
  barberId: string;
  item: ContentRecord;
  onDelete: () => void;
  onChange: () => Promise<void>;
}) {
  const selection = useImageSelection();
  const [upload, setUpload] = useState<UploadState>({ progress: 0, error: '' });
  const [mutating, setMutating] = useState(false);
  const replace = async () => {
    if (!selection.file || mutating) return;
    setMutating(true);
    setUpload({ progress: 0, error: '' });
    try {
      await replaceContentImage(
        barberId,
        collectionName,
        item,
        selection.file,
        (progress) => setUpload({ progress, error: '' }),
        collectionName === 'barbers' ? 'photoUrl' : 'imageUrl',
      );
      selection.clear();
      setUpload({ progress: 0, error: '' });
      await onChange();
    } catch (error) {
      setUpload((value) => ({
        ...value,
        error: error instanceof Error ? error.message : 'No se pudo reemplazar la imagen.',
      }));
    } finally {
      setMutating(false);
    }
  };
  const toggleActive = async () => {
    if (!('active' in item) || mutating) return;
    setMutating(true);
    try {
      await updateContentRecord(barberId, collectionName, item.id, { active: !item.active });
      await onChange();
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'No se pudo actualizar el estado.');
    } finally {
      setMutating(false);
    }
  };
  const label = 'title' in item ? item.title : item.name;
  const imageUrl =
    collectionName === 'barbers'
      ? (item as BarberStaff).photoUrl
      : (item as CatalogItem | Product | Service).imageUrl;
  const description =
    'description' in item && typeof item.description === 'string' ? item.description : '';
  const isStaffProfile = collectionName === 'barbers';
  return (
    <div className="surface-soft rounded-xl p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {imageUrl && <img src={imageUrl} alt="" className="h-12 w-12 rounded-lg object-cover" />}
          <div>
            <p className="font-medium text-main">{label}</p>
            {'tags' in item && <p className="text-xs text-subtle">{item.tags.join(', ')}</p>}
            {description && <p className="text-xs text-subtle">{description}</p>}
            {'price' in item && (
              <p className="text-xs text-subtle">
                ${item.price}
                {'duration' in item ? ` · ${item.duration} min` : ''}
              </p>
            )}
            {'active' in item && (
              <p className="text-xs text-subtle">{item.active ? 'Activo' : 'Inactivo'}</p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {'active' in item && (!isStaffProfile || !(item as BarberStaff).accountStatus) && (
            <button
              type="button"
              disabled={mutating}
              onClick={toggleActive}
              className="btn-outline content-row-action"
            >
              {item.active ? 'Desactivar' : 'Activar'}
            </button>
          )}
          {isStaffProfile && (
            <RetireProfessionalControl
              barberId={barberId}
              member={item as BarberStaff}
              onChange={onChange}
            />
          )}
          {!isStaffProfile && (
            <button
              type="button"
              disabled={mutating}
              onClick={onDelete}
              className="danger-action content-row-action"
            >
              Eliminar
            </button>
          )}
        </div>
      </div>
      {!isStaffProfile && (
        <div className="mt-3 flex flex-wrap items-start gap-3">
          <ImagePicker selection={selection} label="Reemplazar imagen" />
          {selection.file && (
            <button
              type="button"
              disabled={mutating}
              className="btn-primary rounded-lg px-3 py-2 text-sm disabled:opacity-50"
              onClick={replace}
            >
              {mutating
                ? 'Guardando…'
                : `Guardar imagen${upload.progress > 0 ? ` (${upload.progress}%)` : ''}`}
            </button>
          )}
          {upload.error && (
            <p className="error-message text-sm">
              {upload.error}
              <button type="button" className="underline" onClick={replace}>
                Reintentar
              </button>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
