import React, { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { getBarberCatalog } from '../../../lib/barbers';
import { getUserRecord, signOut } from '../../../lib/auth';
import { auth, db } from '../../../lib/firebase';
import { customThemeCssVariables, resolvePublicTheme } from '../../../lib/public-theme';
import { normalizeUserRole } from '../../../lib/roles';
import { isPublicBookingAvailable } from '../../../lib/booking';
import { loadPublicBusinessBySlug } from '../../../lib/public-business';
import type {
  CatalogItem,
  PublicBookingProduct,
  PublicBookingService,
  PublicBookingStaff,
  PublicBusiness,
} from '../../../lib/types';
import PublicBusinessLocationMap from '../business/PublicBusinessLocationMap';
import PublicBookingWidget from './PublicBookingWidget';
import PublicFlipCard from './PublicFlipCard';
import PublicAppointmentsPanel from './PublicAppointmentsPanel';
import LoginForm from '../LoginForm';

type BarberTab = 'inicio' | 'agendar' | 'catalogo' | 'productos' | 'ubicacion' | 'cuenta';
type DeferredResource<T> = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  data: T[];
  error: string;
};
type PublicBusinessLoadFailure = { title: string; description: string; retry: boolean };
type AccountMenu = {
  name: string;
  email: string;
  photoUrl?: string;
  roleLabel: string;
  roleLink?: { label: string; href: string };
  note?: string;
};
const emptyDeferredResource = <T,>(): DeferredResource<T> => ({
  status: 'idle',
  data: [],
  error: '',
});
const TAB_LABELS: Record<BarberTab, string> = {
  inicio: 'Inicio',
  agendar: 'Agendar',
  catalogo: 'Galería',
  productos: 'Productos',
  ubicacion: 'Ubicación',
  cuenta: 'Mis agendamientos',
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

function getBarberIdFromPath(pathname: string) {
  const parts = pathname.split('/').filter(Boolean);
  const index = parts.indexOf('b');
  return index === -1 || !parts[index + 1] ? null : decodeURIComponent(parts[index + 1]);
}
function getWhatsappUrl(phone?: string) {
  const normalized = phone?.replace(/\D/g, '');
  const colombianMobile =
    normalized?.length === 10 && normalized.startsWith('3') ? `57${normalized}` : normalized;
  return colombianMobile ? `https://wa.me/${colombianMobile}` : null;
}
function getTelephoneUrl(phone?: string) {
  const digits = phone?.replace(/\D/g, '');
  const normalized = digits && phone?.trim().startsWith('+') ? `+${digits}` : digits;
  return normalized ? `tel:${normalized}` : null;
}
function getOpenStreetMapUrl(address?: string) {
  return address?.trim()
    ? `https://www.openstreetmap.org/search?query=${encodeURIComponent(address.trim())}`
    : null;
}
function formatPrice(price: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(price);
}
function currentBusinessUrl() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}
function initialsFor(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0])
      .join('')
      .toLocaleUpperCase('es-CO') || 'TU'
  );
}
function publicBusinessLoadFailure(cause: unknown): PublicBusinessLoadFailure {
  const code =
    typeof cause === 'object' && cause !== null && 'code' in cause
      ? (cause as { code?: unknown }).code
      : undefined;

  if (code === 'permission-denied') {
    return {
      title: 'Negocio no disponible',
      description: 'Este negocio no está disponible para visitas públicas en este momento.',
      retry: false,
    };
  }
  if (code === 'not-found') {
    return {
      title: 'Negocio no encontrado',
      description: 'No encontramos un negocio disponible para esta URL.',
      retry: false,
    };
  }
  if (code === 'unavailable' || code === 'deadline-exceeded') {
    return {
      title: 'Servicio no disponible',
      description:
        'No pudimos conectar con el servicio. Verifica tu conexión e inténtalo nuevamente.',
      retry: true,
    };
  }
  return {
    title: 'No pudimos cargar el negocio',
    description: 'No podemos mostrar este negocio en este momento.',
    retry: false,
  };
}
function resolvePublicFaviconUrl(logoUrl?: string) {
  if (!logoUrl?.trim()) return null;
  try {
    const url = new URL(logoUrl.trim(), window.location.href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function usePublicBookingAvailability(business: PublicBusiness | null): boolean {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    setNow(new Date());
    const cutoff =
      business?.bookingEnabledUntil && typeof business.bookingEnabledUntil.toDate === 'function'
        ? business.bookingEnabledUntil.toDate()
        : null;
    if (!cutoff || !Number.isFinite(cutoff.getTime())) return undefined;

    const delay = Math.min(Math.max(cutoff.getTime() - Date.now() + 1, 1_000), 2_147_483_647);
    const timer = window.setTimeout(() => setNow(new Date()), delay);
    return () => window.clearTimeout(timer);
  }, [business?.bookingEnabledUntil]);

  return Boolean(business && isPublicBookingAvailable(business, now));
}

export default function BarberApp() {
  const [barberSlug, setBarberSlug] = useState<string | null>(null);
  const [barber, setBarber] = useState<PublicBusiness | null>(null);
  const [catalog, setCatalog] = useState<DeferredResource<CatalogItem>>(emptyDeferredResource);
  const [products, setProducts] =
    useState<DeferredResource<PublicBookingProduct>>(emptyDeferredResource);
  const [services, setServices] = useState<PublicBookingService[]>([]);
  const [staff, setStaff] = useState<PublicBookingStaff[]>([]);
  const [tab, setTab] = useState<BarberTab>(() =>
    new URLSearchParams(window.location.search).has('account') ? 'cuenta' : 'inicio',
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<PublicBusinessLoadFailure | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);
  const [coverFailed, setCoverFailed] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const canBook = usePublicBookingAvailability(barber);

  useEffect(() => setBarberSlug(getBarberIdFromPath(window.location.pathname)), []);
  useEffect(() => {
    if (!barberSlug) {
      setLoading(false);
      return;
    }
    void (async () => {
      setLoading(true);
      setError(null);
      setBarber(null);
      try {
        const data = await loadPublicBusinessBySlug(barberSlug);
        setBarber(data.business);
        setCatalog(emptyDeferredResource());
        setProducts({ status: 'ready', data: data.products, error: '' });
        setServices(data.services);
        setStaff(data.staff);
      } catch (cause) {
        console.error(cause);
        setError(publicBusinessLoadFailure(cause));
      } finally {
        setLoading(false);
      }
    })();
  }, [barberSlug, reloadVersion]);
  useEffect(() => {
    setLogoFailed(false);
    setCoverFailed(false);
  }, [barber?.config?.logoUrl, barber?.config?.coverUrl]);
  useEffect(() => {
    if (!barber) return;
    const address = barber.config.address?.trim();
    const pageContext = canBook ? `Agendamiento en ${barber.name}` : barber.name;
    const pageDescription = canBook
      ? address
        ? `Agenda con ${barber.name}, ${address}.`
        : `Agenda directamente con ${barber.name}.`
      : address
        ? `Consulta la información de ${barber.name}, ${address}.`
        : `Consulta la información de ${barber.name}.`;
    document.title = pageContext;
    document.querySelector('meta[name="description"]')?.setAttribute('content', pageDescription);
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', pageContext);
    document
      .querySelector('meta[property="og:description"]')
      ?.setAttribute('content', pageDescription);
  }, [barber, canBook]);
  useEffect(() => {
    if (!canBook && tab === 'agendar') setTab('inicio');
  }, [canBook, tab]);
  useEffect(() => {
    if (!barber) return;
    const favicon = document.querySelector<HTMLLinkElement>('#site-favicon');
    if (!favicon) return;

    const fallbackUrl = `${import.meta.env.BASE_URL}images/logo.png`;
    const logoUrl = resolvePublicFaviconUrl(barber.config.logoUrl);
    favicon.href = fallbackUrl;
    if (!logoUrl) return;

    let active = true;
    const logo = new Image();
    logo.onload = () => {
      if (active) favicon.href = logoUrl;
    };
    logo.onerror = () => {
      if (active) favicon.href = fallbackUrl;
    };
    logo.src = logoUrl;
    return () => {
      active = false;
    };
  }, [barber]);

  const loadCatalog = async (force = false) => {
    if (!barber || (!force && catalog.status !== 'idle')) return;
    setCatalog((current) => ({ ...current, status: 'loading', error: '' }));
    try {
      setCatalog({ status: 'ready', data: await getBarberCatalog(barber.id), error: '' });
    } catch (cause) {
      console.error(cause);
      setCatalog((current) => ({
        ...current,
        status: 'error',
        error: 'No pudimos cargar la Galería. Inténtalo nuevamente.',
      }));
    }
  };
  useEffect(() => {
    if (tab === 'catalogo') void loadCatalog();
  }, [tab, barber?.id]);

  if (loading) return <PublicState title="Cargando negocio..." />;
  if (error)
    return (
      <PublicState
        title={error.title}
        description={error.description}
        action={error.retry ? 'Reintentar' : undefined}
        onAction={error.retry ? () => setReloadVersion((value) => value + 1) : undefined}
      />
    );
  if (!barberSlug || !barber)
    return (
      <PublicState
        title="Negocio no encontrado"
        description="No encontramos un negocio activo para esta URL."
      />
    );

  const theme = resolvePublicTheme(barber.config.theme);
  const themeVariables = theme.customPalette
    ? customThemeCssVariables(theme.customPalette)
    : undefined;
  const address = barber.config.address?.trim();
  const phone = barber.config.phone?.trim();
  const telephoneUrl = getTelephoneUrl(phone);
  const whatsappUrl = getWhatsappUrl(barber.config.socialLinks?.whatsapp || barber.config.phone);
  const openStreetMapUrl = getOpenStreetMapUrl(address);
  const hasMapMarker = Boolean(barber.config.location);
  const showTab = (next: BarberTab) => {
    setTab(next);
    window.requestAnimationFrame(() =>
      document.getElementById('public-business-content')?.focus({ preventScroll: true }),
    );
  };
  const publicHome = `${import.meta.env.BASE_URL}b/${encodeURIComponent(barberSlug)}`;

  return (
    <div
      className={`public-business public-booking-refinement public-theme-${theme.id}`}
      data-public-theme={theme.id}
      style={themeVariables}
    >
      <PublicBusinessHeader business={barber} homeUrl={publicHome} />
      <main className="public-business-shell">
        <section
          className={`public-business-hero ${barber.config.coverUrl && !coverFailed ? 'has-cover' : ''}`}
        >
          {barber.config.coverUrl && !coverFailed && (
            <img
              className="public-business-cover"
              src={barber.config.coverUrl}
              alt=""
              fetchPriority="high"
              onError={() => setCoverFailed(true)}
            />
          )}
          <div className="public-business-hero-overlay" />
          <div className="public-business-hero-content">
            <div className="public-business-hero-identity">
              <div className="public-business-identity">
                {barber.config.logoUrl && !logoFailed ? (
                  <img
                    src={barber.config.logoUrl}
                    alt={`Logo de ${barber.name}`}
                    className="public-business-logo"
                    onError={() => setLogoFailed(true)}
                  />
                ) : (
                  <div
                    className="public-business-logo public-business-logo-fallback"
                    aria-hidden="true"
                  >
                    {barber.name.slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div>
                  <p className="public-business-kicker">
                    {canBook ? 'Agendamiento en línea' : 'Información del negocio'}
                  </p>
                  <h1>{barber.name}</h1>
                  {address && <p className="public-business-address">{address}</p>}
                  {!canBook && (
                    <p className="public-business-address" role="status">
                      El agendamiento en línea no está disponible en este momento.
                    </p>
                  )}
                </div>
              </div>
            </div>
            <div className="public-business-hero-actions">
              {canBook && (
                <button
                  type="button"
                  className="btn-primary public-business-hero-cta"
                  onClick={() => showTab('agendar')}
                >
                  Agendar
                </button>
              )}
              {hasMapMarker && (
                <button
                  type="button"
                  className="public-business-location-cta"
                  onClick={() => showTab('ubicacion')}
                >
                  Ver ubicación
                </button>
              )}
              {!hasMapMarker && openStreetMapUrl && (
                <a
                  className="public-business-location-cta"
                  href={openStreetMapUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Buscar en OpenStreetMap
                </a>
              )}
            </div>
          </div>
        </section>
        <nav className="public-business-tabs" aria-label="Secciones del negocio">
          <ul>
            {(Object.keys(TAB_LABELS) as BarberTab[])
              .filter(
                (key) =>
                  (canBook || key !== 'agendar') &&
                  (products.status !== 'ready' || products.data.length > 0 || key !== 'productos'),
              )
              .map((key) => (
                <li key={key}>
                  <button
                    type="button"
                    className={tab === key ? 'is-active' : ''}
                    aria-current={tab === key ? 'page' : undefined}
                    onClick={() => showTab(key)}
                  >
                    {TAB_LABELS[key]}
                  </button>
                </li>
              ))}
          </ul>
        </nav>
        <section id="public-business-content" tabIndex={-1} className="public-business-content">
          {tab === 'inicio' && (
            <BusinessOverview
              business={barber}
              address={address}
              telephoneUrl={telephoneUrl}
              whatsappUrl={whatsappUrl}
              openStreetMapUrl={openStreetMapUrl}
              hasMapMarker={hasMapMarker}
              canBook={canBook}
              onReserve={() => showTab('agendar')}
              onLocation={() => showTab('ubicacion')}
            />
          )}
          {tab === 'agendar' && canBook && (
            <PublicBookingWidget
              business={barber}
              products={products.data}
              services={services}
              staff={staff}
              whatsappUrl={whatsappUrl}
            />
          )}
          {tab === 'catalogo' && (
            <CatalogContent state={catalog} reload={() => void loadCatalog(true)} />
          )}
          {tab === 'productos' && (
            <ProductsContent
              state={products}
              retry={() => setReloadVersion((value) => value + 1)}
              whatsappUrl={whatsappUrl}
            />
          )}
          {tab === 'ubicacion' && (
            <PublicLocationContent
              address={address}
              coordinates={barber.config.location}
              openStreetMapUrl={openStreetMapUrl}
            />
          )}
          {tab === 'cuenta' &&
            (new URLSearchParams(window.location.search).get('account') === 'login' ? (
              <LoginForm />
            ) : (
              <PublicAppointmentsPanel businessId={barber.id} />
            ))}
        </section>
      </main>
    </div>
  );
}

function PublicBusinessHeader({
  business,
  homeUrl,
}: {
  business: PublicBusiness;
  homeUrl: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [account, setAccount] = useState<AccountMenu | null>(null);
  const [brandLogoFailed, setBrandLogoFailed] = useState(false);
  const menuWrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const resolutionRef = useRef(0);
  const baseUrl = import.meta.env.BASE_URL;
  const returnTo = encodeURIComponent(currentBusinessUrl());

  useEffect(
    () =>
      onAuthStateChanged(auth, (user) => {
        const resolution = ++resolutionRef.current;
        if (!user) {
          setAccount(null);
          return;
        }
        setAccount(fallbackAccount(user));
        void resolveAccountMenu(user, baseUrl).then((resolved) => {
          if (resolution === resolutionRef.current && auth.currentUser?.uid === user.uid)
            setAccount(resolved);
        });
      }),
    [baseUrl],
  );
  useEffect(() => setBrandLogoFailed(false), [business.config.logoUrl]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!menuWrapRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
    };
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);
  const logout = async () => {
    ++resolutionRef.current;
    setAccount(null);
    await signOut();
    closeMenu();
  };
  const avatar = account && <AccountAvatar account={account} />;

  return (
    <header className="public-business-site-header">
      <div className="public-business-site-header-inner">
        <a
          href={homeUrl}
          className="public-business-site-brand"
          aria-label={`Inicio de ${business.name}`}
        >
          {business.config.logoUrl && !brandLogoFailed ? (
            <img src={business.config.logoUrl} alt="" onError={() => setBrandLogoFailed(true)} />
          ) : (
            <span className="public-business-site-brand-fallback" aria-hidden="true">
              {initialsFor(business.name)}
            </span>
          )}
        </a>
        <div ref={menuWrapRef} className="account-menu-wrap public-business-menu-wrap">
          <button
            ref={triggerRef}
            type="button"
            className="account-menu-trigger public-business-menu-trigger"
            aria-label={menuOpen ? 'Cerrar menú de cuenta' : 'Abrir menú de cuenta'}
            aria-expanded={menuOpen}
            aria-controls="public-business-account-menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {avatar || (
              <span className="public-business-menu-icon" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            )}
          </button>
          {menuOpen && (
            <div
              id="public-business-account-menu"
              className="account-menu-popover public-business-account-menu"
              role="dialog"
              aria-label="Menú de cuenta"
            >
              {account ? (
                <>
                  <div className="account-menu-identity public-business-account-identity">
                    <AccountAvatar account={account} />
                    <div>
                      <strong>{account.name}</strong>
                      <span>{account.email}</span>
                    </div>
                  </div>
                  <div className="account-menu-role public-business-account-role">
                    <span>{account.roleLabel}</span>
                    <a href={`${homeUrl}?account=bookings`} onClick={closeMenu}>
                      Mis agendamientos
                    </a>
                    {account.roleLink && (
                      <a href={account.roleLink.href} onClick={closeMenu}>
                        {account.roleLink.label}
                      </a>
                    )}
                    {account.note && <p>{account.note}</p>}
                  </div>
                  <button
                    type="button"
                    className="account-menu-button public-business-account-logout"
                    onClick={() => void logout()}
                  >
                    Cerrar sesión
                  </button>
                </>
              ) : (
                <div className="public-business-account-guest">
                  <a
                    className="account-menu-button"
                    href={`${homeUrl}?account=login`}
                    onClick={closeMenu}
                  >
                    Iniciar sesión
                  </a>
                  <a
                    className="account-menu-button account-menu-option"
                    href={`${homeUrl}?account=login&mode=register`}
                    onClick={closeMenu}
                  >
                    Crear cuenta
                  </a>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function AccountAvatar({ account }: { account: AccountMenu }) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [account.photoUrl]);
  return (
    <span className="public-business-avatar" aria-hidden="true">
      {account.photoUrl && !imageFailed ? (
        <span className="public-business-avatar-image">
          <img src={account.photoUrl} alt="" onError={() => setImageFailed(true)} />
        </span>
      ) : (
        initialsFor(account.name)
      )}
    </span>
  );
}

function fallbackAccount(user: FirebaseUser): AccountMenu {
  return {
    name: user.displayName || user.email?.split('@')[0] || 'Tu cuenta',
    email: user.email || '',
    photoUrl: user.photoURL || undefined,
    roleLabel: 'Cuenta',
    note: 'Verificando cuenta...',
  };
}

async function resolveAccountMenu(user: FirebaseUser, baseUrl: string): Promise<AccountMenu> {
  const fallback = { ...fallbackAccount(user), note: 'No pudimos verificar tu cuenta.' };
  try {
    const userRecord = await getUserRecord(user.uid);
    if (auth.currentUser?.uid !== user.uid || !userRecord) return fallback;
    const role = normalizeUserRole(userRecord.role);
    const name = userRecord.name || userRecord.displayName || fallback.name;
    const email = userRecord.email || user.email || '';
    if (role === 'superadmin')
      return {
        name,
        email,
        roleLabel: 'Superadministrador',
        roleLink: { label: 'Ir al panel de control', href: `${baseUrl}admin` },
      };
    if (role === 'storeadmin')
      return accountWithProfessionalProfile(
        userRecord.professionalBusinessId,
        userRecord.staffId,
        name,
        email,
        'Administrador del negocio',
        { label: 'Ir a administración', href: `${baseUrl}admin` },
      );
    if (role === 'staff') {
      const businessId =
        userRecord.businessIds?.length === 1 ? userRecord.businessIds[0] : undefined;
      if (!businessId || !userRecord.staffId)
        return { name, email, roleLabel: 'Personal', note: 'No pudimos verificar tu acceso.' };
      const profile = await getDoc(doc(db, 'barbers', businessId, 'barbers', userRecord.staffId));
      if (auth.currentUser?.uid !== user.uid) return fallback;
      const data = profile.data();
      const profileName =
        typeof data?.name === 'string' && data.name.trim() ? data.name.trim() : name;
      const photoUrl = typeof data?.photoUrl === 'string' ? data.photoUrl : undefined;
      const active = profile.exists() && data?.accountStatus === 'active' && data.active === true;
      return active
        ? {
            name: profileName,
            email,
            photoUrl,
            roleLabel: 'Personal',
            roleLink: { label: 'Ir a administración', href: `${baseUrl}admin` },
          }
        : {
            name: profileName,
            email,
            photoUrl,
            roleLabel: 'Personal',
            roleLink: { label: 'Mi cuenta', href: `${baseUrl}account` },
            note: 'Acceso inactivo',
          };
    }
    return {
      name,
      email,
      roleLabel: 'Cliente',
      roleLink: { label: 'Mi cuenta', href: `${baseUrl}account` },
    };
  } catch (error) {
    console.error('Unable to verify public business account:', error);
    return fallback;
  }
}

async function accountWithProfessionalProfile(
  businessId: string | undefined,
  staffId: string | undefined,
  name: string,
  email: string,
  roleLabel: string,
  roleLink: { label: string; href: string },
): Promise<AccountMenu> {
  if (!businessId || !staffId) return { name, email, roleLabel, roleLink };
  try {
    const profile = await getDoc(doc(db, 'barbers', businessId, 'barbers', staffId));
    const data = profile.data();
    return {
      name: typeof data?.name === 'string' && data.name.trim() ? data.name.trim() : name,
      email,
      photoUrl: typeof data?.photoUrl === 'string' ? data.photoUrl : undefined,
      roleLabel,
      roleLink,
    };
  } catch (error) {
    console.warn('Unable to load public business professional profile:', error);
    return { name, email, roleLabel, roleLink };
  }
}

function PublicState({
  title,
  description,
  action,
  onAction,
}: {
  title: string;
  description?: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="public-business public-booking-refinement">
      <main className="public-business-shell public-business-state">
        <div>
          <h1>{title}</h1>
          {description && <p>{description}</p>}
          {action && onAction && (
            <button type="button" className="btn-primary mt-5 px-4 py-2" onClick={onAction}>
              {action}
            </button>
          )}
        </div>
      </main>
    </div>
  );
}
function BusinessOverview({
  business,
  address,
  telephoneUrl,
  whatsappUrl,
  openStreetMapUrl,
  hasMapMarker,
  canBook,
  onReserve,
  onLocation,
}: {
  business: PublicBusiness;
  address?: string;
  telephoneUrl: string | null;
  whatsappUrl: string | null;
  openStreetMapUrl: string | null;
  hasMapMarker: boolean;
  canBook: boolean;
  onReserve: () => void;
  onLocation: () => void;
}) {
  return (
    <div className="public-business-overview">
      <section className="public-business-intro-copy">
        <p className="public-business-kicker">
          {canBook ? 'Planifica tu visita' : 'Conoce el negocio'}
        </p>
        <h2>{canBook ? 'Agenda con claridad.' : 'Información para tu visita.'}</h2>
        <p>
          {canBook
            ? 'Consulta horarios, datos de contacto y disponibilidad antes de enviar tu solicitud.'
            : 'Consulta horarios, ubicación y datos de contacto.'}
        </p>
        {canBook && (
          <button
            type="button"
            className="btn-primary public-business-overview-cta"
            onClick={onReserve}
          >
            Agendar
          </button>
        )}
      </section>
      <aside className="public-business-details" aria-label="Información del negocio">
        <section className="public-business-detail-row">
          <div>
            <p className="public-business-detail-label">Ubicación</p>
            <h3>{address || 'Ubicación'}</h3>
            {business.config.location && (
              <p className="public-business-location-status">Punto exacto disponible.</p>
            )}
          </div>
          {hasMapMarker && (
            <button type="button" className="public-business-text-action" onClick={onLocation}>
              Ver mapa<span aria-hidden="true">→</span>
            </button>
          )}
          {!hasMapMarker && openStreetMapUrl && (
            <a
              className="public-business-text-action"
              href={openStreetMapUrl}
              target="_blank"
              rel="noreferrer"
            >
              Buscar en OpenStreetMap<span aria-hidden="true">↗</span>
            </a>
          )}
        </section>
        <section className="public-business-detail-row">
          <div>
            <p className="public-business-detail-label">Contacto</p>
            <h3>{business.config.phone || 'Teléfono no disponible'}</h3>
            {business.config.socialLinks?.whatsapp && (
              <p>WhatsApp: {business.config.socialLinks.whatsapp}</p>
            )}
          </div>
          {(telephoneUrl || whatsappUrl) && (
            <div className="public-business-contact-actions">
              {telephoneUrl && (
                <a
                  className="public-business-text-action"
                  href={telephoneUrl}
                  aria-label={`Llamar a ${business.config.phone}`}
                >
                  Llamar<span aria-hidden="true">↗</span>
                </a>
              )}
              {whatsappUrl && (
                <a
                  className="public-business-text-action"
                  href={whatsappUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Abrir WhatsApp de ${business.name}`}
                >
                  WhatsApp<span aria-hidden="true">↗</span>
                </a>
              )}
            </div>
          )}
        </section>
        <section className="public-business-hours">
          <p className="public-business-detail-label">Horario</p>
          <ul>
            {Object.entries(business.workingHours || {}).map(([day, config]) => (
              <li key={day}>
                <span>{DAYS[Number(day)]}</span>
                <span>{config.enabled ? `${config.open} – ${config.close}` : 'Cerrado'}</span>
              </li>
            ))}
          </ul>
        </section>
      </aside>
    </div>
  );
}
function CatalogContent({
  state,
  reload,
}: {
  state: DeferredResource<CatalogItem>;
  reload: () => void;
}) {
  if (state.status === 'loading')
    return <PublicCollectionState kind="loading" label="Cargando Galería..." />;
  if (state.status === 'error') return <ErrorMessage message={state.error} retry={reload} />;
  if (!state.data.length)
    return <PublicCollectionState kind="empty" label="Todavía no hay fotos publicadas." />;

  return (
    <div>
      <header className="public-business-section-heading">
        <p className="public-business-kicker">Inspiración</p>
        <h2>Galería</h2>
      </header>
      <div className="public-business-catalog-grid">
        {state.data.map((item) => (
          <CatalogCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

function CatalogCard({ item }: { item: CatalogItem }) {
  const description =
    typeof item.description === 'string' && item.description.trim()
      ? item.description.trim()
      : 'Este elemento aún no tiene una descripción disponible.';
  return (
    <PublicFlipCard
      title={item.title}
      className="public-business-catalog-card"
      front={() => (
        <>
          <CatalogVisual item={item} />
          <div className="public-business-flip-card-content">
            <div className="public-business-card-heading">
              <h3>{item.title}</h3>
            </div>
            {item.tags?.length > 0 && (
              <ul className="public-business-card-tags" aria-label={`Etiquetas de ${item.title}`}>
                {item.tags.slice(0, 3).map((tag) => (
                  <li key={tag}>{tag}</li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
      back={() => (
        <div className="public-business-card-back-content">
          <div>
            <h3>{item.title}</h3>
            <p>{description}</p>
          </div>
        </div>
      )}
    />
  );
}
function ProductsContent({
  state,
  retry,
  whatsappUrl,
}: {
  state: DeferredResource<PublicBookingProduct>;
  retry: () => void;
  whatsappUrl: string | null;
}) {
  if (state.status === 'loading' || state.status === 'idle')
    return <PublicCollectionState kind="loading" label="Cargando productos..." />;
  if (state.status === 'error') return <ErrorMessage message={state.error} retry={retry} />;
  if (!state.data.length)
    return <PublicCollectionState kind="empty" label="Todavía no hay productos publicados." />;
  return (
    <div>
      <header className="public-business-section-heading">
        <h2>Productos</h2>
        <p>Explora cada producto, conoce sus detalles y consulta su disponibilidad al agendar.</p>
      </header>
      <ul className="public-business-products-grid">
        {state.data.map((product) => (
          <li key={product.id}>
            <ProductCard product={product} whatsappUrl={whatsappUrl} />
          </li>
        ))}
      </ul>
    </div>
  );
}
function ProductCard({
  product,
  whatsappUrl,
}: {
  product: PublicBookingProduct;
  whatsappUrl: string | null;
}) {
  const description =
    product.description || 'Este producto aún no tiene una descripción disponible.';
  return (
    <PublicFlipCard
      title={product.name}
      className="public-business-product-card"
      front={() => (
        <>
          <ProductVisual product={product} />
          <div className="public-business-flip-card-content">
            <p className="public-business-product-label">Producto disponible</p>
            <div className="public-business-card-heading">
              <h3>{product.name}</h3>
              <p className="public-business-product-price">{formatPrice(product.price)}</p>
            </div>
            {product.tags?.length ? (
              <ul className="public-business-card-tags" aria-label={`Etiquetas de ${product.name}`}>
                {product.tags.slice(0, 3).map((tag) => (
                  <li key={tag}>{tag}</li>
                ))}
              </ul>
            ) : (
              <div className="public-business-product-meta"></div>
            )}
          </div>
        </>
      )}
      back={() => (
        <div className="public-business-card-back-content public-business-product-back">
          <div>
            <h3>{product.name}</h3>
            <p>{description}</p>
            <p className="public-business-product-back-price">{formatPrice(product.price)}</p>
          </div>
          <div className="public-business-card-back-actions">
            {whatsappUrl && (
              <a
                className="public-business-flip-card-toggle public-business-product-contact"
                href={whatsappUrl}
                target="_blank"
                rel="noreferrer"
              >
                Consultar por WhatsApp <span aria-hidden="true">↗</span>
              </a>
            )}
          </div>
        </div>
      )}
    />
  );
}
function CatalogVisual({ item }: { item: CatalogItem }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [item.imageUrl]);
  if (!failed)
    return (
      <img
        className="public-business-card-image"
        src={item.imageUrl}
        alt={item.title}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  return (
    <div
      className="public-business-card-placeholder"
      aria-label={`Imagen no disponible para ${item.title}`}
    >
      <span aria-hidden="true">✦</span>
      <strong>{item.title.slice(0, 1).toLocaleUpperCase('es-CO')}</strong>
      <small>Galería del negocio</small>
    </div>
  );
}
function ProductVisual({ product }: { product: PublicBookingProduct }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [product.imageUrl]);
  if (product.imageUrl && !failed)
    return (
      <img
        className="public-business-card-image"
        src={product.imageUrl}
        alt={product.name}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  return (
    <div
      className="public-business-product-placeholder"
      aria-label={`Imagen no disponible para ${product.name}`}
    >
      <span className="public-business-product-placeholder-orbit" aria-hidden="true" />
      <span className="public-business-product-placeholder-mark" aria-hidden="true">
        ✦
      </span>
      <strong>{product.name.slice(0, 1).toLocaleUpperCase('es-CO')}</strong>
      <small>Selección especial</small>
    </div>
  );
}
function PublicCollectionState({ kind, label }: { kind: 'loading' | 'empty'; label: string }) {
  return (
    <div
      className={`public-business-collection-state is-${kind}`}
      role={kind === 'loading' ? 'status' : undefined}
    >
      <span className="public-business-collection-state-mark" aria-hidden="true">
        {kind === 'loading' ? '◌' : '✦'}
      </span>
      <p>{label}</p>
      {kind === 'loading' && (
        <span className="sr-only">Espera mientras preparamos esta selección.</span>
      )}
    </div>
  );
}
function ErrorMessage({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="public-business-message" role="alert">
      <p>{message}</p>
      <button type="button" className="btn-outline mt-3 px-3 py-2 text-sm" onClick={retry}>
        Reintentar
      </button>
    </div>
  );
}

function PublicLocationContent({
  address,
  coordinates,
  openStreetMapUrl,
}: {
  address?: string;
  coordinates?: PublicBusiness['config']['location'];
  openStreetMapUrl: string | null;
}) {
  return (
    <div className="public-business-location">
      <header className="public-business-section-heading">
        <p className="public-business-kicker">Visítanos</p>
        <h2>Ubicación</h2>
        <p>
          {address ||
            (coordinates
              ? 'Consulta el punto exacto en el mapa.'
              : 'La dirección estará disponible próximamente.')}
        </p>
        {coordinates && (
          <p className="public-business-location-status">
            El marcador señala el punto exacto seleccionado por el negocio.
          </p>
        )}
      </header>
      {coordinates ? (
        <PublicBusinessLocationMap coordinates={coordinates} address={address} />
      ) : (
        <div className="public-business-message">
          {address && <p>{address}</p>}
          {openStreetMapUrl ? (
            <a className="accent-link" href={openStreetMapUrl} target="_blank" rel="noreferrer">
              Buscar en OpenStreetMap
            </a>
          ) : (
            <p>Este negocio aún no ha configurado su punto exacto.</p>
          )}
        </div>
      )}
    </div>
  );
}
