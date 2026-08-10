import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { getCurrentUser } from '../../lib/auth';
import { getAllBarbers, getBusinessSummaries } from '../../lib/barbers';
import { DATA } from '../../lib/data';
import { isInternalRole, normalizeUserRole } from '../../lib/roles';
import type { Barber, PublicBusiness, User, UserRole } from '../../lib/types';
import { db } from '../../lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { customThemeCssVariables, resolvePublicTheme } from '../../lib/public-theme';
import { loadPublicBusinessBySlug } from '../../lib/public-business';
import SuperAdminApp from './SuperAdminApp';
import BusinessAdminPage from './admin/BusinessAdminPage';

type Session = { user: User; role: UserRole; summaries: PublicBusiness[] };

function BusinessThemeScope({ business, children }: { business: Barber | PublicBusiness; children: React.ReactNode }) {
  const theme = useMemo(() => resolvePublicTheme(business.config.theme), [business.config.theme]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const previousTheme = root.getAttribute('data-theme');
    const variables = theme.customPalette ? customThemeCssVariables(theme.customPalette) : {};
    const previousVariables = Object.fromEntries(Object.keys(variables).map((name) => [name, root.style.getPropertyValue(name)]));
    root.setAttribute('data-theme', theme.id);
    Object.entries(variables).forEach(([name, value]) => root.style.setProperty(name, value));

    return () => {
      if (previousTheme === null) root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', previousTheme);
      Object.entries(previousVariables).forEach(([name, value]) => {
        if (value) root.style.setProperty(name, value);
        else root.style.removeProperty(name);
      });
    };
  }, [theme]);

  return <>{children}</>;
}

function userBusinessIds(user: User) {
  return [...new Set((user.businessIds || []).filter(Boolean))];
}
function staffIdFor(user: User, businessId: string) {
  if (normalizeUserRole(user.role) === DATA.USER_ROLE.STAFF) return user.businessIds?.length === 1 && user.businessIds[0] === businessId ? user.staffId : undefined;
  return user.professionalBusinessId === businessId ? user.staffId : undefined;
}

export default function AdminRoute() {
  const baseUrl = import.meta.env.BASE_URL;
  const [session, setSession] = useState<Session | null>(null);
  const [selected, setSelected] = useState<Barber | PublicBusiness | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    let staffAccessGranted = false;
    const fail = (message: string, cause?: unknown) => {
      if (cause) console.error('Unable to verify administration access:', cause);
      if (!cancelled) {
        setSession(null);
        setError(message);
      }
    };
    const loadBusinessSummaries = async (user: User, role: UserRole) => {
      if (role === DATA.USER_ROLE.SUPERADMIN) {
        if (!cancelled) setSession({ user, role, summaries: [] });
        return;
      }
      const ids = userBusinessIds(user);
      if (!ids.length) {
        if (!cancelled) {
          setError('Tu cuenta no tiene negocios asignados. Solicita una asignación a superadministración.');
          setSession({ user, role, summaries: [] });
        }
        return;
      }
      try {
        const summaries = await getBusinessSummaries(ids);
        if (cancelled) return;
        const missingIds = ids.filter((id) => !summaries.some((summary) => summary.id === id));
        if (missingIds.length > 0) setError(`No se publicaron los resúmenes de negocio para: ${missingIds.join(', ')}. Puede administrar los negocios disponibles; solicite a superadministración crear los resúmenes faltantes.`);
        setSession({ user, role, summaries });
      } catch (cause) {
        console.error('Unable to load assigned business summaries:', { ids, cause });
        if (!cancelled) {
          setError('No fue posible verificar tus negocios asignados. Intenta nuevamente o solicita a superadministración revisar tus asignaciones y las reglas desplegadas.');
          setSession({ user, role, summaries: [] });
        }
      }
    };
    const load = async () => {
      try {
        const current = await getCurrentUser(); const user = current?.userRecord;
        const role = normalizeUserRole(user?.role);
        if (!current || !user || !role) { window.location.replace(`${baseUrl}login`); return; }
        if (!isInternalRole(user.role)) { window.location.replace(`${baseUrl}account`); return; }
        const staffBusinessId = user.businessIds?.length === 1 ? user.businessIds[0] : undefined;
        if (role !== DATA.USER_ROLE.STAFF || !staffBusinessId || !user.staffId) {
          unsubscribe = onSnapshot(doc(db, 'users', user.uid), (snapshot) => {
            if (cancelled || !snapshot.exists()) return window.location.replace(`${baseUrl}login`);
            const nextUser = snapshot.data() as User;
            const nextRole = normalizeUserRole(nextUser.role);
            if (!nextRole) return window.location.replace(`${baseUrl}login`);
            if (!isInternalRole(nextUser.role)) return window.location.replace(`${baseUrl}account`);
            void loadBusinessSummaries(nextUser, nextRole);
          }, (cause) => fail('No fue posible verificar tu acceso de administración. Inténtalo nuevamente.', cause));
          return;
        }
        unsubscribe = onSnapshot(doc(db, 'barbers', staffBusinessId, 'barbers', user.staffId), (staff) => {
          if (cancelled) return;
          const data = staff.data();
          if (data?.accountStatus === 'active') {
            if (!staffAccessGranted) {
              staffAccessGranted = true;
              void loadBusinessSummaries(user, role);
            }
            return;
          }
          window.location.replace(`${baseUrl}account`);
        }, () => window.location.replace(`${baseUrl}account`));
      } catch (cause) {
        fail('No fue posible verificar tu acceso de administración. Inténtalo nuevamente.', cause);
      }
    };
    void load();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [attempt, baseUrl]);
  const select = async (business: Barber | PublicBusiness) => {
    try {
      const selectedBusiness = session.role === DATA.USER_ROLE.SUPERADMIN
        ? business
        : (await loadPublicBusinessBySlug(business.slug)).business;
      setSelected(selectedBusiness);
      const url = new URL(window.location.href);
      url.searchParams.set('business', business.id);
      window.history.replaceState(null, '', url);
    } catch (cause) {
      console.error('Unable to load business booking configuration:', cause);
      setError('No fue posible cargar la configuración del negocio. Inténtalo nuevamente.');
    }
  };
  const back = () => { setSelected(null); const url = new URL(window.location.href); url.searchParams.delete('business'); window.history.replaceState(null, '', url); };
  const refreshSelected = async () => {
    if (!selected) return;
    if (session.role === DATA.USER_ROLE.SUPERADMIN) {
      const next = (await getAllBarbers()).find((business) => business.id === selected.id);
      if (next) setSelected(next);
      return;
    }
    const next = await loadPublicBusinessBySlug(selected.slug);
    setSelected(next.business);
  };
  if (!session && error) return <main className="business-admin-refinement section-shell flex min-h-screen items-center justify-center px-4"><section className="surface-card max-w-md rounded p-6 text-center"><p className="press-label text-[var(--secondary)]">No fue posible verificar el acceso</p><p className="mt-3 text-sm text-main" role="alert">{error}</p><button type="button" className="btn-primary mt-5 rounded px-4 py-2 text-sm font-semibold" onClick={() => { setError(''); setAttempt((value) => value + 1); }}>Reintentar</button></section></main>;
  if (!session) return <div className="business-admin-refinement section-shell flex min-h-screen items-center justify-center"><p className="business-admin-loading press-label shell-fg px-4 py-3">Verificando acceso…</p></div>;
  if (selected) return <BusinessThemeScope business={selected}><div className={session.role === DATA.USER_ROLE.SUPERADMIN ? 'business-admin-refinement' : 'business-admin-refinement business-admin-quiet'}><BusinessAdminPage business={selected} role={session.role} staffId={staffIdFor(session.user, selected.id)} userId={session.user.uid} profileName={session.user.name || session.user.displayName} onBack={back} onRefresh={refreshSelected} /></div></BusinessThemeScope>;
  if (session.role === DATA.USER_ROLE.SUPERADMIN) return <SuperAdminApp onSelectBusiness={select} />;
  return <main className="business-admin-refinement business-admin-selector section-shell min-h-screen"><div className="mx-auto max-w-5xl px-4 py-8 sm:py-12"><header className="shell-fg mb-8 border-b border-[var(--border)] pb-6"><p className="press-kicker">Administración / selección</p><h1 className="mt-3 text-3xl font-black">Elija un negocio</h1><p className="shell-fg-muted mt-2 text-sm">{session.role === DATA.USER_ROLE.STAFF ? 'Personal · su negocio asignado.' : 'Administrador del negocio · solo los negocios asignados.'}</p></header>{error && <p className="business-admin-selector-state mb-4 p-3 text-sm">{error}</p>}<div className="grid gap-4 sm:grid-cols-2">{session.summaries.map((business) => <button key={business.id} type="button" onClick={() => void select(business)} className="business-admin-selector-card surface-card registration-mark rounded p-5 text-left"><p className="press-label text-[var(--secondary)]">Negocio asignado</p><h2 className="mt-4 text-lg font-bold text-main">{business.name}</h2><p className="mt-1 text-sm text-subtle">/b/{business.slug}</p><span className="mt-4 inline-block text-sm font-bold text-(--secondary)">Abrir administración →</span></button>)}</div>{!error && session.summaries.length === 0 && <p className="business-admin-selector-state mt-4 p-5 text-sm text-subtle">No hay negocios disponibles para esta cuenta.</p>}</div></main>;
}
