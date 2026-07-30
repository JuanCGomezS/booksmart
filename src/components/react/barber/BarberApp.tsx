import React, { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { getBarberCatalog, getBarberConfigBySlug, getBarberProducts } from '../../../lib/barbers';
import { getUserRecord, signOut } from '../../../lib/auth';
import { auth, db } from '../../../lib/firebase';
import { resolvePublicThemeId } from '../../../lib/public-theme';
import { normalizeUserRole } from '../../../lib/roles';
import type { CatalogItem, Product, PublicBusiness } from '../../../lib/types';
import PublicBusinessLocationMap from '../business/PublicBusinessLocationMap';
import PublicBookingWidget from './PublicBookingWidget';

type BarberTab = 'inicio' | 'agendar' | 'catalogo' | 'productos' | 'ubicacion';
type DeferredResource<T> = { status: 'idle' | 'loading' | 'ready' | 'error'; data: T[]; error: string };
type AccountMenu = { name: string; email: string; photoUrl?: string; roleLabel: string; roleLink?: { label: string; href: string }; note?: string };
const emptyDeferredResource = <T,>(): DeferredResource<T> => ({ status: 'idle', data: [], error: '' });
const TAB_LABELS: Record<BarberTab, string> = { inicio: 'Inicio', agendar: 'Reservar', catalogo: 'Catálogo', productos: 'Productos', ubicacion: 'Ubicación' };
const DAYS: Record<number, string> = { 0: 'Domingo', 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sábado' };

function getBarberIdFromPath(pathname: string) { const parts = pathname.split('/').filter(Boolean); const index = parts.indexOf('b'); return index === -1 || !parts[index + 1] ? null : decodeURIComponent(parts[index + 1]); }
function getWhatsappUrl(phone?: string) { const normalized = phone?.replace(/\D/g, ''); const colombianMobile = normalized?.length === 10 && normalized.startsWith('3') ? `57${normalized}` : normalized; return colombianMobile ? `https://wa.me/${colombianMobile}` : null; }
function getTelephoneUrl(phone?: string) { const digits = phone?.replace(/\D/g, ''); const normalized = digits && phone?.trim().startsWith('+') ? `+${digits}` : digits; return normalized ? `tel:${normalized}` : null; }
function getOpenStreetMapUrl(address?: string) { return address?.trim() ? `https://www.openstreetmap.org/search?query=${encodeURIComponent(address.trim())}` : null; }
function formatPrice(price: number) { return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(price); }
function currentBusinessUrl() { return `${window.location.pathname}${window.location.search}${window.location.hash}`; }
function initialsFor(name: string) { return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toLocaleUpperCase('es-CO') || 'TU'; }

export default function BarberApp() {
  const [barberSlug, setBarberSlug] = useState<string | null>(null);
  const [barber, setBarber] = useState<PublicBusiness | null>(null);
  const [catalog, setCatalog] = useState<DeferredResource<CatalogItem>>(emptyDeferredResource);
  const [products, setProducts] = useState<DeferredResource<Product>>(emptyDeferredResource);
  const [tab, setTab] = useState<BarberTab>('inicio');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [logoFailed, setLogoFailed] = useState(false);
  const [coverFailed, setCoverFailed] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => setBarberSlug(getBarberIdFromPath(window.location.pathname)), []);
  useEffect(() => {
    if (!barberSlug) { setLoading(false); return; }
    void (async () => { setLoading(true); setError(''); setBarber(null); try { const data = await getBarberConfigBySlug(barberSlug); setBarber(data); setCatalog(emptyDeferredResource()); setProducts(emptyDeferredResource()); } catch (cause) { console.error(cause); setError('No pudimos cargar el negocio. Revisa tu conexión e inténtalo nuevamente.'); } finally { setLoading(false); } })();
  }, [barberSlug, reloadVersion]);
  useEffect(() => { setLogoFailed(false); setCoverFailed(false); }, [barber?.config?.logoUrl, barber?.config?.coverUrl]);
  useEffect(() => {
    if (!barber) return;
    const address = barber.config.address?.trim();
    const pageContext = `Reservas en ${barber.name}`;
    const pageDescription = address ? `Reserva tu cita en ${barber.name}, ${address}.` : `Reserva tu cita directamente con ${barber.name}.`;
    document.title = pageContext;
    document.querySelector('meta[name="description"]')?.setAttribute('content', pageDescription);
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', pageContext);
    document.querySelector('meta[property="og:description"]')?.setAttribute('content', pageDescription);
  }, [barber]);

  const loadCatalog = async (force = false) => { if (!barber || (!force && catalog.status !== 'idle')) return; setCatalog((current) => ({ ...current, status: 'loading', error: '' })); try { setCatalog({ status: 'ready', data: await getBarberCatalog(barber.id), error: '' }); } catch (cause) { console.error(cause); setCatalog((current) => ({ ...current, status: 'error', error: 'No pudimos cargar el catálogo. Inténtalo nuevamente.' })); } };
  const loadProducts = async (force = false) => { if (!barber || (!force && products.status !== 'idle')) return; setProducts((current) => ({ ...current, status: 'loading', error: '' })); try { setProducts({ status: 'ready', data: await getBarberProducts(barber.id), error: '' }); } catch (cause) { console.error(cause); setProducts((current) => ({ ...current, status: 'error', error: 'No pudimos cargar los productos. Inténtalo nuevamente.' })); } };
  useEffect(() => { if (tab === 'catalogo') void loadCatalog(); if (tab === 'productos') void loadProducts(); }, [tab, barber?.id]);

  if (loading) return <PublicState title="Cargando negocio..." />;
  if (error) return <PublicState title="Error de carga" description={error} action="Reintentar" onAction={() => setReloadVersion((value) => value + 1)} />;
  if (!barberSlug || !barber) return <PublicState title="Negocio no encontrado" description="No encontramos un negocio activo para esta URL." />;

  const themeId = resolvePublicThemeId(barber.config.theme?.id);
  const address = barber.config.address?.trim();
  const phone = barber.config.phone?.trim();
  const telephoneUrl = getTelephoneUrl(phone);
  const whatsappUrl = getWhatsappUrl(barber.config.socialLinks?.whatsapp || barber.config.phone);
  const openStreetMapUrl = getOpenStreetMapUrl(address);
  const hasMapMarker = Boolean(barber.config.location);
  const showTab = (next: BarberTab) => { setTab(next); window.requestAnimationFrame(() => document.getElementById('public-business-content')?.focus({ preventScroll: true })); };
  const publicHome = `${import.meta.env.BASE_URL}b/${encodeURIComponent(barberSlug)}`;

  return <div className={`public-business public-booking-refinement public-theme-${themeId}`} data-public-theme={themeId}>
    <PublicBusinessHeader business={barber} homeUrl={publicHome} />
    <main className="public-business-shell">
      <section className={`public-business-hero ${barber.config.coverUrl && !coverFailed ? 'has-cover' : ''}`}>
        {barber.config.coverUrl && !coverFailed && <img className="public-business-cover" src={barber.config.coverUrl} alt="" fetchPriority="high" onError={() => setCoverFailed(true)} />}
        <div className="public-business-hero-overlay" />
        <div className="public-business-hero-content">
          <div className="public-business-hero-identity">
            <div className="public-business-identity">
              {barber.config.logoUrl && !logoFailed ? <img src={barber.config.logoUrl} alt={`Logo de ${barber.name}`} className="public-business-logo" onError={() => setLogoFailed(true)} /> : <div className="public-business-logo public-business-logo-fallback" aria-hidden="true">{barber.name.slice(0, 2).toUpperCase()}</div>}
              <div><p className="public-business-kicker">Reservas en línea</p><h1>{barber.name}</h1>{address && <p className="public-business-address">{address}</p>}</div>
            </div>
          </div>
          <div className="public-business-hero-actions">
            <button type="button" className="btn-primary public-business-hero-cta" onClick={() => showTab('agendar')}>Reservar una cita</button>
            {hasMapMarker && <button type="button" className="public-business-location-cta" onClick={() => showTab('ubicacion')}>Ver ubicación</button>}
            {!hasMapMarker && openStreetMapUrl && <a className="public-business-location-cta" href={openStreetMapUrl} target="_blank" rel="noreferrer">Buscar en OpenStreetMap</a>}
          </div>
        </div>
      </section>
      <nav className="public-business-tabs" aria-label="Secciones del negocio"><ul>{(Object.keys(TAB_LABELS) as BarberTab[]).map((key) => <li key={key}><button type="button" className={tab === key ? 'is-active' : ''} aria-current={tab === key ? 'page' : undefined} onClick={() => showTab(key)}>{TAB_LABELS[key]}</button></li>)}</ul></nav>
      <section id="public-business-content" tabIndex={-1} className="public-business-content">
        {tab === 'inicio' && <BusinessOverview business={barber} address={address} telephoneUrl={telephoneUrl} whatsappUrl={whatsappUrl} openStreetMapUrl={openStreetMapUrl} hasMapMarker={hasMapMarker} onReserve={() => showTab('agendar')} onLocation={() => showTab('ubicacion')} />}
        {tab === 'agendar' && <PublicBookingWidget business={barber} whatsappUrl={whatsappUrl} />}
        {tab === 'catalogo' && <CatalogContent state={catalog} reload={() => void loadCatalog(true)} />}
        {tab === 'productos' && <ProductsContent state={products} whatsappUrl={whatsappUrl} reload={() => void loadProducts(true)} />}
        {tab === 'ubicacion' && <PublicLocationContent address={address} coordinates={barber.config.location} openStreetMapUrl={openStreetMapUrl} />}
      </section>
    </main>
  </div>;
}

function PublicBusinessHeader({ business, homeUrl }: { business: PublicBusiness; homeUrl: string }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [account, setAccount] = useState<AccountMenu | null>(null);
  const [brandLogoFailed, setBrandLogoFailed] = useState(false);
  const menuWrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const resolutionRef = useRef(0);
  const baseUrl = import.meta.env.BASE_URL;
  const returnTo = encodeURIComponent(currentBusinessUrl());

  useEffect(() => onAuthStateChanged(auth, (user) => {
    const resolution = ++resolutionRef.current;
    if (!user) { setAccount(null); return; }
    setAccount(fallbackAccount(user));
    void resolveAccountMenu(user, baseUrl).then((resolved) => {
      if (resolution === resolutionRef.current && auth.currentUser?.uid === user.uid) setAccount(resolved);
    });
  }), [baseUrl]);
  useEffect(() => setBrandLogoFailed(false), [business.config.logoUrl]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMenuOpen(false); triggerRef.current?.focus(); }
    };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!menuWrapRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => { document.removeEventListener('keydown', closeOnEscape); document.removeEventListener('pointerdown', closeOnOutsidePointer); };
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);
  const logout = async () => { ++resolutionRef.current; setAccount(null); await signOut(); closeMenu(); };
  const avatar = account && <AccountAvatar account={account} />;

  return <header className="public-business-site-header">
    <div className="public-business-site-header-inner">
      <a href={homeUrl} className="public-business-site-brand" aria-label={`Inicio de ${business.name}`}>
        {business.config.logoUrl && !brandLogoFailed ? <img src={business.config.logoUrl} alt="" onError={() => setBrandLogoFailed(true)} /> : <span className="public-business-site-brand-fallback" aria-hidden="true">{initialsFor(business.name)}</span>}
      </a>
      <div ref={menuWrapRef} className="account-menu-wrap public-business-menu-wrap">
        <button ref={triggerRef} type="button" className="account-menu-trigger public-business-menu-trigger" aria-label={menuOpen ? 'Cerrar menú de cuenta' : 'Abrir menú de cuenta'} aria-expanded={menuOpen} aria-controls="public-business-account-menu" onClick={() => setMenuOpen((open) => !open)}>
          {avatar || <span className="public-business-menu-icon" aria-hidden="true"><i /><i /><i /></span>}
        </button>
        {menuOpen && <div id="public-business-account-menu" className="account-menu-popover public-business-account-menu" role="dialog" aria-label="Menú de cuenta">
          {account ? <>
            <div className="account-menu-identity public-business-account-identity">
              <AccountAvatar account={account} />
              <div><strong>{account.name}</strong><span>{account.email}</span></div>
            </div>
            <div className="account-menu-role public-business-account-role"><span>{account.roleLabel}</span>{account.roleLink && <a href={account.roleLink.href} onClick={closeMenu}>{account.roleLink.label}</a>}{account.note && <p>{account.note}</p>}</div>
            <button type="button" className="account-menu-button public-business-account-logout" onClick={() => void logout()}>Cerrar sesión</button>
          </> : <div className="public-business-account-guest">
            <a className="account-menu-button" href={`${baseUrl}login?returnTo=${returnTo}`} onClick={closeMenu}>Iniciar sesión</a>
            <a className="account-menu-button account-menu-option" href={`${baseUrl}login?mode=register&returnTo=${returnTo}`} onClick={closeMenu}>Crear cuenta</a>
          </div>}
        </div>}
      </div>
    </div>
  </header>;
}

function AccountAvatar({ account }: { account: AccountMenu }) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [account.photoUrl]);
  return <span className="public-business-avatar" aria-hidden="true">{account.photoUrl && !imageFailed ? <span className="public-business-avatar-image"><img src={account.photoUrl} alt="" onError={() => setImageFailed(true)} /></span> : initialsFor(account.name)}</span>;
}

function fallbackAccount(user: FirebaseUser): AccountMenu {
  return { name: user.displayName || user.email?.split('@')[0] || 'Tu cuenta', email: user.email || '', photoUrl: user.photoURL || undefined, roleLabel: 'Cuenta', note: 'Verificando cuenta...' };
}

async function resolveAccountMenu(user: FirebaseUser, baseUrl: string): Promise<AccountMenu> {
  const fallback = { ...fallbackAccount(user), note: 'No pudimos verificar tu cuenta.' };
  try {
    const userRecord = await getUserRecord(user.uid);
    if (auth.currentUser?.uid !== user.uid || !userRecord) return fallback;
    const role = normalizeUserRole(userRecord.role);
    const name = userRecord.name || userRecord.displayName || fallback.name;
    const email = userRecord.email || user.email || '';
    if (role === 'superadmin') return { name, email, roleLabel: 'Superadministrador', roleLink: { label: 'Ir al panel de control', href: `${baseUrl}admin` } };
    if (role === 'storeadmin') return accountWithProfessionalProfile(userRecord.professionalBusinessId, userRecord.staffId, name, email, 'Administrador del negocio', { label: 'Ir a administración', href: `${baseUrl}admin` });
    if (role === 'staff') {
      if (!userRecord.barberId || !userRecord.staffId) return { name, email, roleLabel: 'Personal', note: 'No pudimos verificar tu acceso.' };
      const profile = await getDoc(doc(db, 'barbers', userRecord.barberId, 'barbers', userRecord.staffId));
      if (auth.currentUser?.uid !== user.uid) return fallback;
      const data = profile.data();
      const profileName = typeof data?.name === 'string' && data.name.trim() ? data.name.trim() : name;
      const photoUrl = typeof data?.photoUrl === 'string' ? data.photoUrl : undefined;
      const active = profile.exists() && data?.accountStatus === 'active' && data.active === true;
      return active ? { name: profileName, email, photoUrl, roleLabel: 'Personal', roleLink: { label: 'Ir a administración', href: `${baseUrl}admin` } } : { name: profileName, email, photoUrl, roleLabel: 'Personal', roleLink: { label: 'Mi cuenta', href: `${baseUrl}account` }, note: 'Acceso inactivo' };
    }
    return { name, email, roleLabel: 'Cliente', roleLink: { label: 'Mi cuenta', href: `${baseUrl}account` } };
  } catch (error) { console.error('Unable to verify public business account:', error); return fallback; }
}

async function accountWithProfessionalProfile(businessId: string | undefined, staffId: string | undefined, name: string, email: string, roleLabel: string, roleLink: { label: string; href: string }): Promise<AccountMenu> {
  if (!businessId || !staffId) return { name, email, roleLabel, roleLink };
  try {
    const profile = await getDoc(doc(db, 'barbers', businessId, 'barbers', staffId));
    const data = profile.data();
    return { name: typeof data?.name === 'string' && data.name.trim() ? data.name.trim() : name, email, photoUrl: typeof data?.photoUrl === 'string' ? data.photoUrl : undefined, roleLabel, roleLink };
  } catch (error) { console.warn('Unable to load public business professional profile:', error); return { name, email, roleLabel, roleLink }; }
}

function PublicState({ title, description, action, onAction }: { title: string; description?: string; action?: string; onAction?: () => void }) { return <div className="public-business public-booking-refinement"><main className="public-business-shell public-business-state"><div><h1>{title}</h1>{description && <p>{description}</p>}{action && onAction && <button type="button" className="btn-primary mt-5 px-4 py-2" onClick={onAction}>{action}</button>}</div></main></div>; }
function BusinessOverview({ business, address, telephoneUrl, whatsappUrl, openStreetMapUrl, hasMapMarker, onReserve, onLocation }: { business: PublicBusiness; address?: string; telephoneUrl: string | null; whatsappUrl: string | null; openStreetMapUrl: string | null; hasMapMarker: boolean; onReserve: () => void; onLocation: () => void }) {
  return <div className="public-business-overview">
    <section className="public-business-intro-copy">
      <p className="public-business-kicker">Planifica tu visita</p>
      <h2>Elige tu cita con claridad.</h2>
      <p>Consulta horarios, datos de contacto y disponibilidad antes de elegir tu cita.</p>
      <button type="button" className="btn-primary public-business-overview-cta" onClick={onReserve}>Reservar una cita</button>
    </section>
    <aside className="public-business-details" aria-label="Información del negocio">
      <section className="public-business-detail-row">
        <div><p className="public-business-detail-label">Ubicación</p><h3>{address || 'Ubicación'}</h3>{business.config.location && <p className="public-business-location-status">Punto exacto disponible.</p>}</div>
        {hasMapMarker && <button type="button" className="public-business-text-action" onClick={onLocation}>Ver mapa<span aria-hidden="true">→</span></button>}
        {!hasMapMarker && openStreetMapUrl && <a className="public-business-text-action" href={openStreetMapUrl} target="_blank" rel="noreferrer">Buscar en OpenStreetMap<span aria-hidden="true">↗</span></a>}
      </section>
      <section className="public-business-detail-row">
        <div><p className="public-business-detail-label">Contacto</p><h3>{business.config.phone || 'Teléfono no disponible'}</h3>{business.config.socialLinks?.whatsapp && <p>WhatsApp: {business.config.socialLinks.whatsapp}</p>}</div>
        {(telephoneUrl || whatsappUrl) && <div className="public-business-contact-actions">
          {telephoneUrl && <a className="public-business-text-action" href={telephoneUrl} aria-label={`Llamar a ${business.config.phone}`}>Llamar<span aria-hidden="true">↗</span></a>}
          {whatsappUrl && <a className="public-business-text-action" href={whatsappUrl} target="_blank" rel="noreferrer" aria-label={`Abrir WhatsApp de ${business.name}`}>WhatsApp<span aria-hidden="true">↗</span></a>}
        </div>}
      </section>
      <section className="public-business-hours">
        <p className="public-business-detail-label">Horario</p>
        <ul>{Object.entries(business.workingHours || {}).map(([day, config]) => <li key={day}><span>{DAYS[Number(day)]}</span><span>{config.enabled ? `${config.open} – ${config.close}` : 'Cerrado'}</span></li>)}</ul>
      </section>
    </aside>
  </div>;
}
function CatalogContent({ state, reload }: { state: DeferredResource<CatalogItem>; reload: () => void }) { if (state.status === 'loading') return <p className="public-business-message" role="status">Cargando catálogo...</p>; if (state.status === 'error') return <ErrorMessage message={state.error} retry={reload} />; if (!state.data.length) return <p className="public-business-message">Todavía no hay fotos publicadas.</p>; return <div><header className="public-business-section-heading"><p className="public-business-kicker">Inspiración</p><h2>Catálogo</h2></header><div className="public-business-catalog-grid">{state.data.map((item) => <article key={item.id}><img src={item.imageUrl} alt={item.title} loading="lazy" onError={(event) => { event.currentTarget.style.display = 'none'; }} /><div><h3>{item.title}</h3>{item.tags?.length > 0 && <p>{item.tags.map((tag) => `#${tag}`).join(' · ')}</p>}</div></article>)}</div></div>; }
function ProductsContent({ state, whatsappUrl, reload }: { state: DeferredResource<Product>; whatsappUrl: string | null; reload: () => void }) { if (state.status === 'loading') return <p className="public-business-message" role="status">Cargando productos...</p>; if (state.status === 'error') return <ErrorMessage message={state.error} retry={reload} />; if (!state.data.length) return <p className="public-business-message">No hay productos disponibles por ahora.</p>; return <div><header className="public-business-section-heading"><p className="public-business-kicker">Para llevar</p><h2>Productos</h2></header><div className="public-business-product-list">{state.data.map((product) => <article key={product.id}><div><h3>{product.name}</h3><p>{product.description}</p></div><div><strong>{formatPrice(product.price)}</strong>{whatsappUrl && <a href={whatsappUrl} target="_blank" rel="noreferrer">Consultar por WhatsApp</a>}</div></article>)}</div></div>; }
function ErrorMessage({ message, retry }: { message: string; retry: () => void }) { return <div className="public-business-message" role="alert"><p>{message}</p><button type="button" className="btn-outline mt-3 px-3 py-2 text-sm" onClick={retry}>Reintentar</button></div>; }

function PublicLocationContent({ address, coordinates, openStreetMapUrl }: { address?: string; coordinates?: PublicBusiness['config']['location']; openStreetMapUrl: string | null }) {
  return <div className="public-business-location"><header className="public-business-section-heading"><p className="public-business-kicker">Visítanos</p><h2>Ubicación</h2><p>{address || (coordinates ? 'Consulta el punto exacto en el mapa.' : 'La dirección estará disponible próximamente.')}</p>{coordinates && <p className="public-business-location-status">El marcador señala el punto exacto seleccionado por el negocio.</p>}</header>{coordinates ? <PublicBusinessLocationMap coordinates={coordinates} address={address} /> : <div className="public-business-message">{address && <p>{address}</p>}{openStreetMapUrl ? <a className="accent-link" href={openStreetMapUrl} target="_blank" rel="noreferrer">Buscar en OpenStreetMap</a> : <p>Este negocio aún no ha configurado su punto exacto.</p>}</div>}</div>;
}
