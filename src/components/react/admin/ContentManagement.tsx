import React, { useEffect, useRef, useState } from 'react';
import type { UploadTask } from 'firebase/storage';
import {
  allocateContentRecordId,
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
import { beginLazyResourceLoad, emptyLazyResource, rejectLazyResource, resolveLazyResource, type LazyResourceState } from '../../../lib/lazy-resource';

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

function ImagePicker({ selection, label = 'Seleccionar imagen' }: { selection: ReturnType<typeof useImageSelection>; label?: string }) {
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const reset = () => {
    selection.clear();
    setError('');
    if (inputRef.current) inputRef.current.value = '';
  };
  return <div className="space-y-2">
    <label className="btn-outline inline-flex cursor-pointer rounded-lg px-3 py-2 text-sm font-semibold">
      {label}<input key={selection.inputKey} ref={inputRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
        const nextError = selection.select(event.target.files?.[0] || null);
        setError(nextError);
        if (nextError || !event.target.files?.[0]) event.target.value = '';
      }} />
    </label>
    {selection.previewUrl && <div className="relative aspect-square w-28 overflow-hidden rounded-lg border" style={{ borderColor: 'var(--border)' }}><img src={selection.previewUrl} alt="Vista previa de la imagen seleccionada" className="h-full w-full object-cover" /><button type="button" className="absolute right-1 top-1 rounded bg-black/70 px-2 py-1 text-xs text-white" onClick={reset}>Quitar</button></div>}
    {error && <p className="text-sm" style={{ color: '#fca5a5' }}>{error}</p>}
    <p className="text-xs text-subtle">JPEG, PNG o WebP; máximo 5 MiB.</p>
  </div>;
}

function useContentCreateMutation(barberId: string, collectionName: ContentCollection) {
  const pendingRef = useRef<PendingCreate | null>(null);
  const mountedRef = useRef(true);
  const [inFlight, setInFlight] = useState(false);

  useEffect(() => () => {
    mountedRef.current = false;
    pendingRef.current?.task?.cancel();
  }, []);

  const run = async (save: (recordId: string, onTask: (task: UploadTask | null) => void) => Promise<void>) => {
    if (pendingRef.current?.inFlight) return false;
    const pending = pendingRef.current || { recordId: allocateContentRecordId(barberId, collectionName), task: null, inFlight: false };
    pending.inFlight = true;
    pendingRef.current = pending;
    setInFlight(true);
    try {
      await save(pending.recordId, (task) => { if (pendingRef.current === pending) pending.task = task; });
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

export default function ContentManagement({ barberId, onChange }: { barberId: string; onChange: () => void }) {
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

  const tabs: Array<[ContentTab, string]> = [['gallery', 'Galería'], ['products', 'Productos'], ['services', 'Servicios'], ['staff', 'Personal']];
  return <section className="grid gap-6 md:grid-cols-[11rem_minmax(0,1fr)]">
    <nav aria-label="Secciones de contenido" className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
       {tabs.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={`shrink-0 rounded-lg border-l-2 px-4 py-3 text-left text-sm font-semibold ${tab === key ? 'border-(--secondary) bg-(--surface) text-main' : 'border-transparent text-subtle hover:bg-(--surface)'}`}>{label}</button>)}
    </nav>
    <div role="tabpanel" className="min-w-0">
       {tab === 'gallery' && <GalleryPanel barberId={barberId} state={gallery} reload={() => load('catalog', true)} onChange={onChange} />}
       {tab === 'products' && <ProductsPanel barberId={barberId} state={products} reload={() => load('products', true)} onChange={onChange} />}
       {tab === 'services' && <ServicesPanel barberId={barberId} state={services} reload={() => load('services', true)} onChange={onChange} />}
       {tab === 'staff' && <StaffPanel barberId={barberId} state={staff} reload={() => load('barbers', true)} onChange={onChange} />}
    </div>
  </section>;
}

function ResourceMessage({ loading, error, retry }: { loading: boolean; error: string; retry: () => void }) {
  if (loading) return <p className="text-sm text-subtle">Cargando contenido...</p>;
  if (error) return <div className="rounded-lg p-3 text-sm" style={{ background: 'color-mix(in srgb, #ef4444 14%, var(--surface))', color: '#fecaca' }}>{error}<button type="button" className="ml-3 underline" onClick={retry}>Reintentar</button></div>;
  return null;
}

function GalleryPanel({ barberId, state, reload, onChange }: { barberId: string; state: ResourceState<CatalogItem>; reload: () => void; onChange: () => void }) {
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState('');
  const [upload, setUpload] = useState<UploadState>({ progress: 0, error: '' });
  const selection = useImageSelection();
  const mutation = useContentCreateMutation(barberId, 'catalog');
  const save = async () => {
    if (mutation.inFlight) return;
    if (!title.trim() || !selection.file) return setUpload({ progress: 0, error: 'Ingresá un título y seleccioná una imagen.' });
    setUpload({ progress: 0, error: '' });
    try {
      const saved = await mutation.run(async (recordId, onUploadTask) => { await createContentRecord(barberId, 'catalog', { title: title.trim(), tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean) }, selection.file, (progress) => setUpload({ progress, error: '' }), { recordId, onUploadTask }); });
      if (!saved) return;
      setTitle(''); setTags(''); selection.clear(); setUpload({ progress: 0, error: '' }); await reload(); onChange();
    } catch (error) { setUpload((value) => ({ ...value, error: error instanceof Error && error.message.includes('canceled') ? 'Carga cancelada. Podés reintentar.' : error instanceof Error ? error.message : 'No se pudo guardar la imagen.' })); }
  };
  return <div className="space-y-6"><div><h3 className="text-lg font-bold text-main">Galería</h3><p className="mt-1 text-sm text-subtle">Las imágenes se guardan de forma segura en el almacenamiento del negocio.</p></div><div className="surface-soft grid gap-3 rounded-xl p-4 md:grid-cols-2"><input className="field-input" placeholder="Título" value={title} onChange={(event) => setTitle(event.target.value)} /><input className="field-input" placeholder="Etiquetas separadas por coma" value={tags} onChange={(event) => setTags(event.target.value)} /><ImagePicker selection={selection} />{upload.progress > 0 && <p className="text-sm text-subtle">Subiendo: {upload.progress}%</p>}{upload.error && <p className="text-sm" style={{ color: '#fca5a5' }}>{upload.error} <button type="button" className="underline" onClick={save}>Reintentar</button></p>}<div className="flex gap-2"><button type="button" className="btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50" disabled={state.loading || mutation.inFlight} onClick={save}>{mutation.inFlight ? 'Guardando...' : 'Agregar foto'}</button>{mutation.inFlight && <button type="button" className="btn-outline rounded-lg px-4 py-2 text-sm font-semibold" onClick={mutation.cancel}>Cancelar carga</button>}</div></div><ResourceMessage loading={state.loading} error={state.error} retry={reload} /><ContentList collectionName="catalog" barberId={barberId} items={state.data} reload={reload} onChange={onChange} /></div>;
}

function ProductsPanel({ barberId, state, reload, onChange }: { barberId: string; state: ResourceState<Product>; reload: () => void; onChange: () => void }) {
  const [form, setForm] = useState({ name: '', description: '', price: '', stock: '', active: true });
  const [upload, setUpload] = useState<UploadState>({ progress: 0, error: '' });
  const selection = useImageSelection();
  const mutation = useContentCreateMutation(barberId, 'products');
  const save = async () => {
    if (mutation.inFlight) return;
    if (!form.name.trim() || !form.price) return setUpload({ progress: 0, error: 'Ingresá el nombre y el precio del producto.' });
    setUpload({ progress: 0, error: '' });
    try {
      const saved = await mutation.run(async (recordId, onUploadTask) => { await createContentRecord(barberId, 'products', { name: form.name.trim(), description: form.description.trim(), price: Number(form.price), stock: Number(form.stock || 0), active: form.active }, selection.file, (progress) => setUpload({ progress, error: '' }), { recordId, onUploadTask }); });
      if (!saved) return;
      setForm({ name: '', description: '', price: '', stock: '', active: true }); selection.clear(); setUpload({ progress: 0, error: '' }); await reload(); onChange();
    } catch (error) { setUpload((value) => ({ ...value, error: error instanceof Error && error.message.includes('canceled') ? 'Carga cancelada. Podés reintentar.' : error instanceof Error ? error.message : 'No se pudo guardar el producto.' })); }
  };
  return <div className="space-y-6"><div><h3 className="text-lg font-bold text-main">Productos</h3><p className="mt-1 text-sm text-subtle">La imagen es opcional; al cargarla se guarda junto al producto.</p></div><div className="surface-soft grid gap-3 rounded-xl p-4 md:grid-cols-2"><input className="field-input" placeholder="Nombre" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /><input className="field-input" placeholder="Descripción" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /><input type="number" min="0" className="field-input" placeholder="Precio" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} /><input type="number" min="0" className="field-input" placeholder="Inventario" value={form.stock} onChange={(event) => setForm({ ...form, stock: event.target.value })} /><label className="flex items-center gap-2 text-sm text-main"><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} />Producto activo</label><ImagePicker selection={selection} />{upload.progress > 0 && <p className="text-sm text-subtle">Subiendo: {upload.progress}%</p>}{upload.error && <p className="text-sm" style={{ color: '#fca5a5' }}>{upload.error} <button type="button" className="underline" onClick={save}>Reintentar</button></p>}<div className="flex gap-2"><button type="button" className="btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50" disabled={state.loading || mutation.inFlight} onClick={save}>{mutation.inFlight ? 'Guardando...' : 'Agregar producto'}</button>{mutation.inFlight && selection.file && <button type="button" className="btn-outline rounded-lg px-4 py-2 text-sm font-semibold" onClick={mutation.cancel}>Cancelar carga</button>}</div></div><ResourceMessage loading={state.loading} error={state.error} retry={reload} /><ContentList collectionName="products" barberId={barberId} items={state.data} reload={reload} onChange={onChange} /></div>;
}

function ServicesPanel({ barberId, state, reload, onChange }: { barberId: string; state: ResourceState<Service>; reload: () => void; onChange: () => void }) {
  const [form, setForm] = useState({ name: '', description: '', price: '', duration: '', active: true });
  const [upload, setUpload] = useState<UploadState>({ progress: 0, error: '' });
  const selection = useImageSelection();
  const mutation = useContentCreateMutation(barberId, 'services');
  const save = async () => {
    if (mutation.inFlight) return;
    if (!form.name.trim() || !form.price || !form.duration || Number(form.price) < 0 || Number(form.duration) <= 0) return setUpload({ progress: 0, error: 'Ingresá nombre, precio y duración válida para el servicio.' });
    setUpload({ progress: 0, error: '' });
    try {
      const saved = await mutation.run(async (recordId, onUploadTask) => { await createContentRecord(barberId, 'services', { name: form.name.trim(), description: form.description.trim(), price: Number(form.price), duration: Number(form.duration), active: form.active }, selection.file, (progress) => setUpload({ progress, error: '' }), { recordId, onUploadTask }); });
      if (!saved) return;
      setForm({ name: '', description: '', price: '', duration: '', active: true }); selection.clear(); setUpload({ progress: 0, error: '' }); await reload(); onChange();
    } catch (error) { setUpload((value) => ({ ...value, error: error instanceof Error && error.message.includes('canceled') ? 'Carga cancelada. Podés reintentar.' : error instanceof Error ? error.message : 'No se pudo guardar el servicio.' })); }
  };
  return <div className="space-y-6"><div><h3 className="text-lg font-bold text-main">Servicios</h3><p className="mt-1 text-sm text-subtle">Definí la información comercial del servicio. La compatibilidad y los buffers se configuran exclusivamente en Reservas.</p></div><div className="surface-soft grid gap-3 rounded-xl p-4 md:grid-cols-2"><input className="field-input" placeholder="Nombre" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /><input className="field-input" placeholder="Descripción" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /><input type="number" min="0" className="field-input" placeholder="Precio" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} /><input type="number" min="1" className="field-input" placeholder="Duración (minutos)" value={form.duration} onChange={(event) => setForm({ ...form, duration: event.target.value })} /><label className="flex items-center gap-2 text-sm text-main"><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} />Servicio activo</label><ImagePicker selection={selection} />{upload.progress > 0 && <p className="text-sm text-subtle">Subiendo: {upload.progress}%</p>}{upload.error && <p className="text-sm" style={{ color: '#fca5a5' }}>{upload.error} <button type="button" className="underline" onClick={save}>Reintentar</button></p>}<div className="flex gap-2"><button type="button" className="btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50" disabled={state.loading || mutation.inFlight} onClick={save}>{mutation.inFlight ? 'Guardando...' : 'Agregar servicio'}</button>{mutation.inFlight && selection.file && <button type="button" className="btn-outline rounded-lg px-4 py-2 text-sm font-semibold" onClick={mutation.cancel}>Cancelar carga</button>}</div></div><ResourceMessage loading={state.loading} error={state.error} retry={reload} /><ContentList collectionName="services" barberId={barberId} items={state.data} reload={reload} onChange={onChange} /></div>;
}

function StaffPanel({ barberId, state, reload, onChange }: { barberId: string; state: ResourceState<BarberStaff>; reload: () => void; onChange: () => void }) {
  const [form, setForm] = useState({ name: '', active: true });
  const [upload, setUpload] = useState<UploadState>({ progress: 0, error: '' });
  const selection = useImageSelection();
  const mutation = useContentCreateMutation(barberId, 'barbers');
  const save = async () => {
    if (mutation.inFlight) return;
    if (!form.name.trim()) return setUpload({ progress: 0, error: 'Ingresá el nombre del profesional.' });
    setUpload({ progress: 0, error: '' });
    try {
      const saved = await mutation.run(async (recordId, onUploadTask) => { await createContentRecord(barberId, 'barbers', { name: form.name.trim(), active: form.active }, selection.file, (progress) => setUpload({ progress, error: '' }), { recordId, onUploadTask, imageField: 'photoUrl' }); });
      if (!saved) return;
      setForm({ name: '', active: true }); selection.clear(); setUpload({ progress: 0, error: '' }); await reload(); onChange();
    } catch (error) { setUpload((value) => ({ ...value, error: error instanceof Error && error.message.includes('canceled') ? 'Carga cancelada. Podés reintentar.' : error instanceof Error ? error.message : 'No se pudo guardar el profesional.' })); }
  };
  return <div className="space-y-6"><div><h3 className="text-lg font-bold text-main">Personal</h3><p className="mt-1 text-sm text-subtle">Administrá la identidad y foto del profesional. Los horarios, descansos y compatibilidad viven exclusivamente en Reservas.</p></div><div className="surface-soft grid gap-3 rounded-xl p-4 md:grid-cols-2"><input className="field-input" placeholder="Nombre" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /><label className="flex items-center gap-2 text-sm text-main"><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} />Profesional activo</label><ImagePicker selection={selection} />{upload.progress > 0 && <p className="text-sm text-subtle">Subiendo: {upload.progress}%</p>}{upload.error && <p className="text-sm" style={{ color: '#fca5a5' }}>{upload.error} <button type="button" className="underline" onClick={save}>Reintentar</button></p>}<div className="flex gap-2"><button type="button" className="btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50" disabled={state.loading || mutation.inFlight} onClick={save}>{mutation.inFlight ? 'Guardando...' : 'Agregar profesional'}</button>{mutation.inFlight && selection.file && <button type="button" className="btn-outline rounded-lg px-4 py-2 text-sm font-semibold" onClick={mutation.cancel}>Cancelar carga</button>}</div></div><ResourceMessage loading={state.loading} error={state.error} retry={reload} /><ContentList collectionName="barbers" barberId={barberId} items={state.data} reload={reload} onChange={onChange} /></div>;
}

function ContentList<T extends ContentRecord>({ collectionName, barberId, items, reload, onChange }: { collectionName: ContentCollection; barberId: string; items: T[]; reload: () => void; onChange: () => void }) {
  const [message, setMessage] = useState('');
  const remove = async (item: T) => { if (!window.confirm(`¿Eliminar ${'title' in item ? item.title : item.name}? Esta acción no se puede deshacer.`)) return; try { await deleteContentRecord(barberId, collectionName, item); await reload(); onChange(); } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo eliminar el registro.'); } };
  const edit = async (item: T) => { const field = 'title' in item ? 'title' : 'name'; const current = item[field]; const next = window.prompt(`Editar ${field === 'title' ? 'título' : 'nombre'}`, current); if (!next?.trim()) return; try { await updateContentRecord(barberId, collectionName, item.id, { [field]: next.trim() }); await reload(); onChange(); } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo editar el registro.'); } };
  return <div className="space-y-3">{message && <p className="text-sm" style={{ color: '#fca5a5' }}>{message}</p>}{items.length === 0 ? <p className="text-sm text-subtle">Todavía no hay registros.</p> : items.map((item) => <ContentRow key={item.id} collectionName={collectionName} barberId={barberId} item={item} onDelete={() => remove(item)} onEdit={() => edit(item)} onChange={async () => { await reload(); onChange(); }} />)}</div>;
}

function ContentRow({ collectionName, barberId, item, onDelete, onEdit, onChange }: { collectionName: ContentCollection; barberId: string; item: ContentRecord; onDelete: () => void; onEdit: () => void; onChange: () => Promise<void> }) {
  const selection = useImageSelection();
  const [upload, setUpload] = useState<UploadState>({ progress: 0, error: '' });
  const [mutating, setMutating] = useState(false);
  const replace = async () => { if (!selection.file || mutating) return; setMutating(true); setUpload({ progress: 0, error: '' }); try { await replaceContentImage(barberId, collectionName, item, selection.file, (progress) => setUpload({ progress, error: '' }), collectionName === 'barbers' ? 'photoUrl' : 'imageUrl'); selection.clear(); setUpload({ progress: 0, error: '' }); await onChange(); } catch (error) { setUpload((value) => ({ ...value, error: error instanceof Error ? error.message : 'No se pudo reemplazar la imagen.' })); } finally { setMutating(false); } };
  const toggleActive = async () => { if (!('active' in item) || mutating) return; setMutating(true); try { await updateContentRecord(barberId, collectionName, item.id, { active: !item.active }); await onChange(); } catch (error) { setUpload((value) => ({ ...value, error: error instanceof Error ? error.message : 'No se pudo actualizar el estado.' })); } finally { setMutating(false); } };
  const label = 'title' in item ? item.title : item.name;
  const imageUrl = collectionName === 'barbers' ? (item as BarberStaff).photoUrl : (item as CatalogItem | Product | Service).imageUrl;
  return <div className="surface-soft rounded-xl p-3"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3">{imageUrl && <img src={imageUrl} alt="" className="h-12 w-12 rounded-lg object-cover" />}<div><p className="font-medium text-main">{label}</p>{'tags' in item && <p className="text-xs text-subtle">{item.tags.join(', ')}</p>}{'description' in item && item.description && <p className="text-xs text-subtle">{item.description}</p>}{'price' in item && <p className="text-xs text-subtle">${item.price}{'duration' in item ? ` · ${item.duration} min` : ''}</p>}{'active' in item && <p className="text-xs text-subtle">{item.active ? 'Activo' : 'Inactivo'}</p>}</div></div><div className="flex gap-2">{'active' in item && <button type="button" disabled={mutating} onClick={toggleActive} className="btn-outline rounded px-2 py-1 text-xs">{item.active ? 'Desactivar' : 'Activar'}</button>}<button type="button" disabled={mutating} onClick={onEdit} className="btn-outline rounded px-2 py-1 text-xs">Editar</button><button type="button" disabled={mutating} onClick={onDelete} className="rounded px-2 py-1 text-xs" style={{ color: '#fca5a5', border: '1px solid color-mix(in srgb, #ef4444 45%, var(--border))' }}>Eliminar</button></div></div><div className="mt-3 flex flex-wrap items-start gap-3"><ImagePicker selection={selection} label="Reemplazar imagen" />{selection.file && <button type="button" disabled={mutating} className="btn-primary rounded-lg px-3 py-2 text-sm disabled:opacity-50" onClick={replace}>{mutating ? 'Guardando...' : `Guardar imagen${upload.progress > 0 ? ` (${upload.progress}%)` : ''}`}</button>}{upload.error && <p className="text-sm" style={{ color: '#fca5a5' }}>{upload.error} <button type="button" className="underline" onClick={replace}>Reintentar</button></p>}</div></div>;
}
