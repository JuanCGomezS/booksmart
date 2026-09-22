import { useCallback, useEffect, useId, useRef, useState, type MouseEvent } from 'react';
import { onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { getUserRecord, signOut } from '../../lib/auth';
import { auth, db } from '../../lib/firebase';
import { loadPersonalProfilePhoto } from '../../lib/personal-profile';
import { normalizeUserRole } from '../../lib/roles';
import PersonalProfileEditor from './PersonalProfileEditor';

type AuthMode = 'login' | 'register';
type RoleLink = { label: string; href: string };

type AccountMenuRoleLinks = {
  superadmin?: RoleLink | null;
  storeadmin?: RoleLink | null;
  staff?: RoleLink | null;
  inactiveStaff?: RoleLink | null;
  customer?: RoleLink | null;
};

type GuestNavigation = {
  homeHref: string;
  featuresHref: string;
  contactHref: string;
};

type Props = {
  variant: 'site' | 'public';
  loginTarget?: string;
  preserveLoginReturnPath?: boolean;
  onOpenAuth?: (mode: AuthMode) => void;
  onAccountNavigate?: () => void;
  onBookingsNavigate?: () => void;
  logoutTarget?: string;
  accountHref?: string;
  bookingsHref?: string;
  roleLinks?: AccountMenuRoleLinks;
  guestNavigation?: GuestNavigation;
};

type Account = {
  uid: string;
  name: string;
  email: string;
  photoUrl?: string;
  personalPhotoStoragePath?: string;
  roleLabel: string;
  roleLink?: RoleLink;
  note?: string;
};

const baseUrl = import.meta.env.BASE_URL;
const defaultRoleLinks: Required<AccountMenuRoleLinks> = {
  superadmin: { label: 'Ir al panel de control', href: `${baseUrl}admin` },
  storeadmin: { label: 'Ir a administración', href: `${baseUrl}admin` },
  staff: { label: 'Ir a administración', href: `${baseUrl}admin` },
  inactiveStaff: { label: 'Mi cuenta', href: `${baseUrl}account` },
  customer: { label: 'Mi cuenta', href: `${baseUrl}account` },
};

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

function fallbackAccount(user: FirebaseUser): Account {
  return {
    uid: user.uid,
    name: user.displayName || user.email?.split('@')[0] || 'Tu cuenta',
    email: user.email || '',
    photoUrl: user.photoURL || undefined,
    roleLabel: 'Cuenta',
    note: 'Verificando cuenta...',
  };
}

function roleLink(
  links: AccountMenuRoleLinks | undefined,
  role: keyof AccountMenuRoleLinks,
): RoleLink | undefined {
  const configured = links?.[role];
  return configured === undefined ? defaultRoleLinks[role] || undefined : configured || undefined;
}

function publicPageRoleLinks(
  accountHref: string | undefined,
  roleLinks: AccountMenuRoleLinks | undefined,
): AccountMenuRoleLinks | undefined {
  if (!accountHref) return roleLinks;
  const stay = { label: 'Mi cuenta', href: accountHref };
  return {
    ...roleLinks,
    inactiveStaff: roleLinks?.inactiveStaff === undefined ? stay : roleLinks.inactiveStaff,
    customer: roleLinks?.customer === undefined ? stay : roleLinks.customer,
  };
}

function samePublicAccountHref(href: string, target: string) {
  const left = new URL(href, window.location.href);
  const right = new URL(target, window.location.href);
  return (
    left.pathname === right.pathname &&
    left.searchParams.get('account') === right.searchParams.get('account')
  );
}

async function resolveAccount(
  user: FirebaseUser,
  roleLinks: AccountMenuRoleLinks | undefined,
): Promise<Account> {
  const fallback = { ...fallbackAccount(user), note: 'No pudimos verificar tu cuenta.' };
  try {
    const userRecord = await getUserRecord(user.uid);
    if (auth.currentUser?.uid !== user.uid || !userRecord) return fallback;
    const role = normalizeUserRole(userRecord.role);
    const name = userRecord.name || userRecord.displayName || fallback.name;
    const email = userRecord.email || user.email || '';
    const shared = {
      uid: user.uid,
      name,
      email,
      photoUrl: fallback.photoUrl,
      personalPhotoStoragePath: userRecord.photoStoragePath,
    };

    if (role === 'superadmin')
      return {
        ...shared,
        roleLabel: 'Superadministrador',
        roleLink: roleLink(roleLinks, 'superadmin'),
      };
    if (role === 'storeadmin')
      return {
        ...shared,
        roleLabel: 'Administrador del negocio',
        roleLink: roleLink(roleLinks, 'storeadmin'),
      };
    if (role === 'staff') {
      const businessId =
        userRecord.businessIds?.length === 1 ? userRecord.businessIds[0] : undefined;
      if (!businessId || !userRecord.staffId)
        return {
          ...shared,
          roleLabel: 'Personal',
          note: 'No pudimos verificar tu acceso.',
        };
      const profile = await getDoc(doc(db, 'barbers', businessId, 'barbers', userRecord.staffId));
      if (auth.currentUser?.uid !== user.uid) return fallback;
      const data = profile.data();
      const active = profile.exists() && data?.accountStatus === 'active' && data.active === true;
      return active
        ? {
            ...shared,
            roleLabel: 'Personal',
            roleLink: roleLink(roleLinks, 'staff'),
          }
        : {
            ...shared,
            roleLabel: 'Personal',
            roleLink: roleLink(roleLinks, 'inactiveStaff'),
            note: 'Acceso inactivo',
          };
    }
    return {
      ...shared,
      roleLabel: 'Cliente',
      roleLink: roleLink(roleLinks, 'customer'),
    };
  } catch (error) {
    console.error('Unable to verify account menu:', error);
    return fallback;
  }
}

function AccountAvatar({ account }: { account: Account }) {
  const [personalPhotoUrl, setPersonalPhotoUrl] = useState('');
  const [failedPhotoUrl, setFailedPhotoUrl] = useState('');

  useEffect(() => {
    let active = true;
    let objectUrl = '';
    setPersonalPhotoUrl('');
    setFailedPhotoUrl('');
    if (!account.personalPhotoStoragePath) return undefined;

    void loadPersonalProfilePhoto(account.uid, account.personalPhotoStoragePath)
      .then((url) => {
        objectUrl = url;
        if (active) setPersonalPhotoUrl(url);
        else URL.revokeObjectURL(url);
      })
      .catch(() => active && setPersonalPhotoUrl(''));

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [account.personalPhotoStoragePath, account.uid]);

  const isResolvingAccount = account.note === 'Verificando cuenta...';
  const photoUrl =
    personalPhotoUrl ||
    (!isResolvingAccount && !account.personalPhotoStoragePath ? account.photoUrl : undefined);
  return (
    <span className="account-menu-avatar public-business-avatar" aria-hidden="true">
      {photoUrl && failedPhotoUrl !== photoUrl ? (
        <span className="public-business-avatar-image">
          <img key={photoUrl} src={photoUrl} alt="" onError={() => setFailedPhotoUrl(photoUrl)} />
        </span>
      ) : (
        initialsFor(account.name)
      )}
    </span>
  );
}

function appendQuery(target: string, name: string, value: string) {
  return `${target}${target.includes('?') ? '&' : '?'}${name}=${encodeURIComponent(value)}`;
}

export default function AccountMenu({
  variant,
  loginTarget,
  preserveLoginReturnPath = false,
  onOpenAuth,
  onAccountNavigate,
  onBookingsNavigate,
  logoutTarget,
  accountHref,
  bookingsHref,
  roleLinks,
  guestNavigation,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);
  const [currentPath, setCurrentPath] = useState('');
  const menuWrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const resolutionRef = useRef(0);
  const mountedRef = useRef(false);
  const menuId = `account-menu-${useId().replace(/:/g, '')}`;

  const refreshAccount = useCallback(
    async (nextUser?: FirebaseUser | null) => {
      const user = nextUser === undefined ? auth.currentUser : nextUser;
      const resolution = ++resolutionRef.current;
      if (!user) {
        if (mountedRef.current) setAccount(null);
        return;
      }
      if (mountedRef.current)
        setAccount((current) => (current?.uid === user.uid ? current : fallbackAccount(user)));
      const resolved = await resolveAccount(
        user,
        variant === 'public' ? publicPageRoleLinks(accountHref, roleLinks) : roleLinks,
      );
      if (
        mountedRef.current &&
        resolution === resolutionRef.current &&
        auth.currentUser?.uid === user.uid
      )
        setAccount(resolved);
    },
    [accountHref, roleLinks, variant],
  );

  useEffect(() => {
    mountedRef.current = true;
    const unsubscribe = onAuthStateChanged(auth, (user) => void refreshAccount(user));
    return () => {
      mountedRef.current = false;
      ++resolutionRef.current;
      unsubscribe();
    };
  }, [refreshAccount]);

  useEffect(() => {
    if (preserveLoginReturnPath)
      setCurrentPath(`${window.location.pathname}${window.location.search}${window.location.hash}`);
  }, [preserveLoginReturnPath]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      triggerRef.current?.focus();
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
  const stayOnPublicPage = (event: MouseEvent<HTMLAnchorElement>, href: string) => {
    closeMenu();
    if (accountHref && onAccountNavigate && samePublicAccountHref(href, accountHref)) {
      event.preventDefault();
      onAccountNavigate();
      return;
    }
    if (bookingsHref && onBookingsNavigate && samePublicAccountHref(href, bookingsHref)) {
      event.preventDefault();
      onBookingsNavigate();
    }
  };
  const loginHref =
    loginTarget && preserveLoginReturnPath && currentPath
      ? appendQuery(loginTarget, 'returnTo', currentPath)
      : loginTarget;
  const registerHref = loginHref ? appendQuery(loginHref, 'mode', 'register') : undefined;
  const logout = async () => {
    ++resolutionRef.current;
    setAccount(null);
    await signOut();
    sessionStorage.removeItem('userRole');
    closeMenu();
    if (logoutTarget) window.location.assign(logoutTarget);
  };

  const openAuth = (mode: AuthMode) => {
    closeMenu();
    onOpenAuth?.(mode);
  };

  return (
    <>
      <div
        ref={menuWrapRef}
        className={`account-menu-wrap public-business-menu-wrap account-menu-${variant}`}
      >
        <button
          ref={triggerRef}
          type="button"
          className="account-menu-trigger public-business-menu-trigger"
          aria-label={menuOpen ? 'Cerrar menú de cuenta' : 'Abrir menú de cuenta'}
          aria-expanded={menuOpen}
          aria-controls={menuId}
          onClick={() => setMenuOpen((open) => !open)}
        >
          {account ? (
            <AccountAvatar account={account} />
          ) : (
            <span className="public-business-menu-icon" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          )}
        </button>
        {menuOpen && (
          <div
            id={menuId}
            className="account-menu-popover public-business-account-menu"
            role="dialog"
            aria-label="Menú de cuenta"
          >
            {account ? (
              <>
                <div className="account-menu-identity public-business-account-identity">
                  <div>
                    <div className="public-business-account-name-row">
                      <strong>{account.name}</strong>
                      <button
                        type="button"
                        className="accent-link text-sm font-semibold text-main"
                        onClick={() => {
                          closeMenu();
                          setProfileEditorOpen(true);
                        }}
                      >
                        Editar
                      </button>
                    </div>
                    <span>{account.email}</span>
                  </div>
                </div>
                <div className="account-menu-role public-business-account-role">
                  <span>{account.roleLabel}</span>
                  {bookingsHref && (
                    <a
                      href={bookingsHref}
                      onClick={(event) => stayOnPublicPage(event, bookingsHref)}
                    >
                      Mis agendamientos
                    </a>
                  )}
                  {account.roleLink && (
                    <a
                      href={account.roleLink.href}
                      onClick={(event) => stayOnPublicPage(event, account.roleLink!.href)}
                    >
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
                {guestNavigation && (
                  <>
                    <div className="account-menu-guest-intro border-b pb-4">
                      <p className="text-lg font-bold text-main">Gestiona tu negocio</p>
                      <p className="text-sm text-subtle">
                        Infraestructura 100% gratuita para iniciar
                      </p>
                    </div>
                    <nav className="py-4" aria-label="Navegación principal">
                      <ul className="space-y-2">
                        <li>
                          <a
                            href={guestNavigation.homeHref}
                            className="accent-link block rounded-xl px-3 py-2 text-main transition hover:bg-[color-mix(in_srgb,var(--secondary)_14%,transparent)]"
                            onClick={closeMenu}
                          >
                            Inicio
                          </a>
                        </li>
                        <li>
                          <a
                            href={guestNavigation.featuresHref}
                            className="accent-link block rounded-xl px-3 py-2 text-main transition hover:bg-[color-mix(in_srgb,var(--secondary)_14%,transparent)]"
                            onClick={closeMenu}
                          >
                            Lo que ofrecemos
                          </a>
                        </li>
                        <li>
                          <a
                            href={guestNavigation.contactHref}
                            className="accent-link block rounded-xl px-3 py-2 text-main transition hover:bg-[color-mix(in_srgb,var(--secondary)_14%,transparent)]"
                            onClick={closeMenu}
                          >
                            Contacto
                          </a>
                        </li>
                      </ul>
                    </nav>
                  </>
                )}
                {onOpenAuth ? (
                  <>
                    <button
                      type="button"
                      className="account-menu-button"
                      onClick={() => openAuth('login')}
                    >
                      Iniciar sesión
                    </button>
                    <button
                      type="button"
                      className="account-menu-button account-menu-option"
                      onClick={() => openAuth('register')}
                    >
                      Crear cuenta
                    </button>
                  </>
                ) : (
                  <>
                    <a
                      href={loginHref}
                      className="account-menu-button btn-outline block w-full px-4 py-3 text-center text-sm font-bold"
                      onClick={closeMenu}
                    >
                      Iniciar sesión
                    </a>
                    <a
                      href={registerHref}
                      className="account-menu-button account-menu-option block w-full border px-4 py-3 text-center text-sm font-bold text-main"
                      onClick={closeMenu}
                    >
                      Crear cuenta
                    </a>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      <PersonalProfileEditor
        open={profileEditorOpen}
        theme={variant}
        onClose={() => setProfileEditorOpen(false)}
        onSaved={refreshAccount}
      />
    </>
  );
}
