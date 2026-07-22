import React, { useEffect, useMemo, useState } from 'react';
import { getBarberCatalog, getBarberConfigBySlug, getBarberProducts, getBarberStatus } from '../../../lib/barbers';
import { DATA } from '../../../lib/data';
import type { Barber, CatalogItem, Product } from '../../../lib/types';

type BarberTab = 'inicio' | 'agendar' | 'catalogo' | 'productos' | 'ubicacion';

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
  const [barber, setBarber] = useState<Barber | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [tab, setTab] = useState<BarberTab>('inicio');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
          setCatalog([]);
          setProducts([]);
          return;
        }

        const [catalogData, productsData] = await Promise.all([
          getBarberCatalog(barberData.id),
          getBarberProducts(barberData.id),
        ]);

        setBarber(barberData);
        setCatalog(catalogData);
        setProducts(productsData);
      } catch (err) {
        console.error(err);
          setError('No pudimos cargar el negocio. Intentá nuevamente en unos minutos.');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [barberSlug]);

  const isExpired = useMemo(() => {
    if (!barber) return false;
    return getBarberStatus(barber) === DATA.BARBER_STATUS.EXPIRED;
  }, [barber]);

  const mapsSrc = useMemo(() => {
    const address = barber?.config?.address;
    if (!address) return '';
    return `https://www.google.com/maps?q=${encodeURIComponent(address)}&output=embed`;
  }, [barber]);

  if (loading) {
    return (
      <div className="min-h-screen section-shell flex items-center justify-center px-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 mx-auto mb-4" style={{ borderColor: 'var(--secondary)' }} />
          <p className="text-subtle">Cargando negocio...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen section-shell flex items-center justify-center px-4">
        <div className="surface-card rounded-xl p-6 max-w-xl w-full">
          <h1 className="text-xl font-semibold text-main mb-2">Error de carga</h1>
          <p className="text-subtle">{error}</p>
        </div>
      </div>
    );
  }

  if (!barberSlug || !barber) {
    return (
      <div className="min-h-screen section-shell flex items-center justify-center px-4">
        <div className="surface-card rounded-xl p-6 max-w-xl w-full">
          <h1 className="text-2xl font-semibold text-main mb-2">Negocio no encontrado</h1>
          <p className="text-subtle">No encontramos un negocio activo para esta URL.</p>
        </div>
      </div>
    );
  }

  if (isExpired) {
    return (
      <div className="min-h-screen section-shell flex items-center justify-center px-4">
        <div className="surface-card rounded-xl p-6 max-w-xl w-full">
          <h1 className="text-2xl font-semibold text-main mb-2">Plan expirado</h1>
          <p className="text-subtle">Este negocio está temporalmente fuera de servicio por vencimiento de plan.</p>
        </div>
      </div>
    );
  }

  const whatsappUrl = getWhatsappUrl(barber.config?.socialLinks?.whatsapp || barber.config?.phone);

  return (
    <div className="min-h-screen section-shell">
      <main className="max-w-5xl mx-auto px-4 py-8">
        <header className="surface-card rounded-2xl p-6 mb-6">
          <div className="flex items-start gap-4">
            {barber.config?.logoUrl ? (
              <img src={barber.config.logoUrl} alt={`Logo de ${barber.name}`} className="w-16 h-16 rounded-xl object-cover border" style={{ borderColor: 'var(--border)' }} />
            ) : (
              <div className="w-16 h-16 rounded-xl flex items-center justify-center text-2xl" style={{ background: 'var(--surface-soft)', border: '1px solid var(--border)' }}>
                📅
              </div>
            )}

            <div>
              <h1 className="text-3xl font-bold text-main">{barber.name}</h1>
              <p className="text-subtle">{barber.config?.address || 'Dirección no disponible'}</p>
            </div>
          </div>
        </header>

        <nav className="surface-card rounded-2xl p-2 mb-6">
          <ul className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {(Object.keys(TAB_LABELS) as BarberTab[]).map((tabKey) => (
              <li key={tabKey}>
                <button
                  type="button"
                  className="w-full rounded-xl px-3 py-2 text-sm font-medium transition-colors"
                  style={tab === tabKey
                    ? { background: 'var(--secondary)', color: 'var(--on-secondary)' }
                    : { background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                  onClick={() => setTab(tabKey)}
                >
                  {TAB_LABELS[tabKey]}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <section className="surface-card rounded-2xl p-6">
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
            <div>
              <h2 className="text-xl font-semibold text-main mb-2">Agendar</h2>
              <p className="text-subtle">Estamos preparando el flujo de reservas online. Por ahora, gestioná tu turno por WhatsApp.</p>
              {whatsappUrl && (
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block mt-4 btn-primary px-4 py-2 rounded-xl font-semibold"
                >
                  Reservar por WhatsApp
                </a>
              )}
            </div>
          )}

          {tab === 'catalogo' && (
            <div>
              <h2 className="text-xl font-semibold text-main mb-4">Catálogo</h2>
              {catalog.length === 0 ? (
                <p className="text-subtle">Todavía no hay fotos publicadas.</p>
              ) : (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {catalog.map((item) => (
                    <article key={item.id} className="surface-soft rounded-xl p-3">
                      <img src={item.imageUrl} alt={item.title} className="w-full h-44 object-cover rounded-lg mb-3" />
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
              {products.length === 0 ? (
                <p className="text-subtle">No hay productos disponibles por ahora.</p>
              ) : (
                <div className="space-y-3">
                  {products.map((product) => (
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
