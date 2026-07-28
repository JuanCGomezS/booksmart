import React, { useEffect, useMemo, useState } from 'react';
import { getBarberCatalog, getBarberConfigBySlug, getBarberProducts } from '../../../lib/barbers';
import type { CatalogItem, Product, PublicBusiness } from '../../../lib/types';
import PublicBookingWidget from './PublicBookingWidget';

type BarberTab = 'inicio' | 'agendar' | 'catalogo' | 'productos' | 'ubicacion';
type DeferredResource<T> = { status: 'idle' | 'loading' | 'ready' | 'error'; data: T[]; error: string };

const emptyDeferredResource = <T,>(): DeferredResource<T> => ({ status: 'idle', data: [], error: '' });

const TAB_LABELS: Record<BarberTab, string> = {
  inicio: 'Inicio',
  agendar: 'Agendar',
  catalogo: 'Catálogo',
  productos: 'Productos',
  ubicacion: 'Ubicación',
};

const DAYS: Record<number, string> = {
  0: 'Domingo',
  1: 'Lunes',
  2: 'Martes',
  3: 'Miércoles',
  4: 'Jueves',
  5: 'Viernes',
  6: 'Sábado',
};

function getBarberIdFromPath(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean);
  const barberIndex = parts.indexOf('b');
  if (barberIndex === -1 || !parts[barberIndex + 1]) {
    return null;
  }

  return decodeURIComponent(parts[barberIndex + 1]);
}

function getWhatsappUrl(phone?: string): string | null {
  if (!phone) return null;
  const normalized = phone.replace(/\D/g, '');
  if (!normalized) return null;
  return `https://wa.me/${normalized}`;
}

function formatPrice(price: number): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(price);
}

export default function BarberApp() {
  const [barberSlug, setBarberSlug] = useState<string | null>(null);
  const [barber, setBarber] = useState<PublicBusiness | null>(null);
  const [catalog, setCatalog] = useState<DeferredResource<CatalogItem>>(emptyDeferredResource);
  const [products, setProducts] = useState<DeferredResource<Product>>(emptyDeferredResource);
  const [tab, setTab] = useState<BarberTab>('inicio');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [logoFailed, setLogoFailed] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    const id = getBarberIdFromPath(window.location.pathname);
    setBarberSlug(id);
  }, []);

  useEffect(() => {
    if (!barberSlug) {
      setLoading(false);
      return;
    }

    const load = async () => {
      setLoading(true);
      setError('');

      try {
        const barberData = await getBarberConfigBySlug(barberSlug);

        if (!barberData) {
          setBarber(null);
          setCatalog(emptyDeferredResource());
          setProducts(emptyDeferredResource());
          return;
        }

        setBarber(barberData);
      } catch (err) {
        console.error(err);
          setError('No pudimos cargar el negocio. Intentá nuevamente en unos minutos.');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [barberSlug, reloadVersion]);

  const loadCatalog = async (force = false) => {
    if (!barber || (!force && catalog.status !== 'idle')) return;
    setCatalog((current) => ({ ...current, status: 'loading', error: '' }));
    try { setCatalog({ status: 'ready', data: await getBarberCatalog(barber.id), error: '' }); }
    catch (cause) { console.error(cause); setCatalog((current) => ({ ...current, status: 'error', error: 'No pudimos cargar el catálogo. Inténtalo nuevamente.' })); }
  };

  const loadProducts = async (force = false) => {
    if (!barber || (!force && products.status !== 'idle')) return;
    setProducts((current) => ({ ...current, status: 'loading', error: '' }));
    try { setProducts({ status: 'ready', data: await getBarberProducts(barber.id), error: '' }); }
    catch (cause) { console.error(cause); setProducts((current) => ({ ...current, status: 'error', error: 'No pudimos cargar los productos. Inténtalo nuevamente.' })); }
  };

  useEffect(() => { if (tab === 'catalogo') void loadCatalog(); }, [tab, barber?.id]);
  useEffect(() => { if (tab === 'productos') void loadProducts(); }, [tab, barber?.id]);
  useEffect(() => { setLogoFailed(false); }, [barber?.config?.logoUrl]);

  const mapsSrc = useMemo(() => {
    const address = barber?.config?.address;
    if (!address) return '';
    return `https://www.google.com/maps?q=${encodeURIComponent(address)}&output=embed`;
  }, [barber]);

  if (loading) {
    return (
      <div className="public-booking-refinement min-h-screen section-shell flex items-center justify-center px-4">
        <div className="text-center">
          <div className="animate-spin mx-auto mb-4 h-10 w-10 border-2" style={{ borderColor: 'var(--secondary)' }} />
          <p className="text-subtle">Cargando negocio...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="public-booking-refinement min-h-screen section-shell flex items-center justify-center px-4">
        <div className="surface-card rounded-xl p-6 max-w-xl w-full">
          <h1 className="text-xl font-semibold text-main mb-2">Error de carga</h1>
          <p className="text-subtle">{error}</p>
          <button type="button" className="btn-primary mt-4 px-4 py-2" onClick={() => setReloadVersion((version) => version + 1)}>Reintentar</button>
        </div>
      </div>
    );
  }

  if (!barberSlug || !barber) {
    return (
      <div className="public-booking-refinement min-h-screen section-shell flex items-center justify-center px-4">
        <div className="surface-card rounded-xl p-6 max-w-xl w-full">
          <h1 className="text-2xl font-semibold text-main mb-2">Negocio no encontrado</h1>
          <p className="text-subtle">No encontramos un negocio activo para esta URL.</p>
        </div>
      </div>
    );
  }

  const whatsappUrl = getWhatsappUrl(barber.config?.socialLinks?.whatsapp || barber.config?.phone);

  return (
    <div className="public-booking-refinement min-h-screen section-shell">
      <main className="max-w-5xl mx-auto px-4 py-8 sm:py-12">
        <header className="press-panel-dark registration-mark mb-6 p-5 sm:p-7">
          <div className="flex items-start gap-4">
            {barber.config?.logoUrl && !logoFailed ? (
              <img src={barber.config.logoUrl} alt={`Logo de ${barber.name}`} className="h-16 w-16 border border-[#f1eee6] object-cover" onError={() => setLogoFailed(true)} />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center border border-[#f1eee6] text-2xl" style={{ background: '#f13b87', color: '#101114' }}>
                📅
              </div>
            )}

            <div>
              <p className="press-kicker text-[#ffb400]">Página pública / reservas</p>
              <h1 className="mt-2 text-3xl font-black text-[#f1eee6]">{barber.name}</h1>
              <p className="mt-1 text-[#d8d3c8]">{barber.config?.address || 'Dirección no disponible'}</p>
            </div>
          </div>
        </header>

        <nav className="surface-card mb-6 rounded p-2" aria-label="Secciones del negocio">
          <ul className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {(Object.keys(TAB_LABELS) as BarberTab[]).map((tabKey) => (
              <li key={tabKey}>
                <button
                  type="button"
                  className="w-full rounded px-3 py-2 text-sm font-bold transition-colors"
                  style={tab === tabKey
                    ? { background: 'var(--secondary)', color: 'var(--on-secondary)', boxShadow: '3px 3px 0 #101114' }
                    : { background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                  onClick={() => setTab(tabKey)}
                >
                  {TAB_LABELS[tabKey]}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <section className="surface-card registration-mark rounded p-5 sm:p-7">
          {tab === 'inicio' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold text-main mb-2">Inicio</h2>
                <p className="text-subtle">Conocé el negocio y su información principal.</p>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="surface-soft rounded-xl p-4">
                  <h3 className="font-semibold text-main mb-2">Contacto</h3>
                  <p className="text-subtle">Teléfono: {barber.config?.phone || 'No disponible'}</p>
                  <div className="text-subtle mt-2 space-y-1">
                    <p>Instagram: {barber.config?.socialLinks?.instagram || 'No disponible'}</p>
                    <p>Facebook: {barber.config?.socialLinks?.facebook || 'No disponible'}</p>
                    <p>WhatsApp: {barber.config?.socialLinks?.whatsapp || barber.config?.phone || 'No disponible'}</p>
                  </div>
                </div>

                <div className="surface-soft rounded-xl p-4">
                  <h3 className="font-semibold text-main mb-2">Horario</h3>
                  <ul className="space-y-1 text-subtle text-sm">
                    {Object.entries(barber.workingHours || {}).map(([day, config]) => (
                      <li key={day}>
                        {DAYS[Number(day)]}: {config.enabled ? `${config.open} - ${config.close}` : 'Cerrado'}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {tab === 'agendar' && (
            <PublicBookingWidget business={barber} whatsappUrl={whatsappUrl} />
          )}

          {tab === 'catalogo' && (
            <div>
              <h2 className="text-xl font-semibold text-main mb-4">Catálogo</h2>
              {catalog.status === 'loading' ? <p className="text-subtle" role="status">Cargando catálogo...</p> : catalog.status === 'error' ? <div className="status-cancelled flex flex-wrap items-center gap-3 rounded border p-3 text-sm" role="alert"><span>{catalog.error}</span><button type="button" className="btn-outline px-3 py-1 text-sm" onClick={() => void loadCatalog(true)}>Reintentar</button></div> : catalog.status === 'ready' && catalog.data.length === 0 ? (
                <p className="text-subtle">Todavía no hay fotos publicadas.</p>
              ) : (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {catalog.data.map((item) => (
                    <article key={item.id} className="surface-soft rounded-xl p-3">
                      <img src={item.imageUrl} alt={item.title} className="w-full h-44 object-cover rounded-lg mb-3" loading="lazy" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
                      <h3 className="font-semibold text-main mb-2">{item.title}</h3>
                      <div className="flex flex-wrap gap-2">
                        {(item.tags || []).map((tag) => (
                          <span key={`${item.id}-${tag}`} className="badge-theme text-xs px-2 py-1 rounded-full">#{tag}</span>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'productos' && (
            <div>
              <h2 className="text-xl font-semibold text-main mb-4">Productos</h2>
              {products.status === 'loading' ? <p className="text-subtle" role="status">Cargando productos...</p> : products.status === 'error' ? <div className="status-cancelled flex flex-wrap items-center gap-3 rounded border p-3 text-sm" role="alert"><span>{products.error}</span><button type="button" className="btn-outline px-3 py-1 text-sm" onClick={() => void loadProducts(true)}>Reintentar</button></div> : products.status === 'ready' && products.data.length === 0 ? (
                <p className="text-subtle">No hay productos disponibles por ahora.</p>
              ) : (
                <div className="space-y-3">
                  {products.data.map((product) => (
                    <article key={product.id} className="surface-soft rounded-xl p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                      <div>
                        <h3 className="font-semibold text-main">{product.name}</h3>
                        <p className="text-subtle text-sm">{product.description}</p>
                        <p className="text-main font-bold mt-2">{formatPrice(product.price)}</p>
                      </div>

                      {whatsappUrl && (
                        <a href={whatsappUrl} target="_blank" rel="noreferrer" className="btn-primary px-4 py-2 rounded-xl font-semibold text-center">
                          Consultar por WhatsApp
                        </a>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'ubicacion' && (
            <div>
              <h2 className="text-xl font-semibold text-main mb-3">Ubicación</h2>
              {mapsSrc ? (
                <iframe
                  title={`Ubicación de ${barber.name}`}
                  src={mapsSrc}
                  className="w-full h-96 rounded-xl border"
                  style={{ borderColor: 'var(--border)' }}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              ) : (
                <p className="text-subtle">No hay dirección configurada todavía.</p>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
