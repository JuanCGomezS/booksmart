import React, { useEffect, useState } from 'react';
import { getCurrentUser } from '../../lib/auth';
import { getBusinessSummaries } from '../../lib/barbers';
import { DATA } from '../../lib/data';
import { isInternalRole, normalizeUserRole } from '../../lib/roles';
import type { Barber, PublicBusiness, StaffAssignment, User, UserRole } from '../../lib/types';
import SuperAdminApp from './SuperAdminApp';
import BusinessAdminPage from './admin/BusinessAdminPage';

type Session = { user: User; role: UserRole; summaries: PublicBusiness[] };
function userBusinessIds(user: User) {
  const assignmentIds = normalizeUserRole(user.role) === DATA.USER_ROLE.STAFF ? (user.staffAssignments || []).map((item) => item.businessId) : [];
  return [...new Set([...(user.businessIds || []), ...assignmentIds, user.barberId || ''].filter(Boolean))];
}
function staffIdFor(user: User, businessId: string) {
  const assignment = (user.staffAssignments || []).find((item: StaffAssignment) => item.businessId === businessId);
  return assignment?.staffId || (user.barberId === businessId ? user.staffId : undefined);
}

export default function AdminRoute() {
  const baseUrl = import.meta.env.BASE_URL;
  const [session, setSession] = useState<Session | null>(null);
  const [selected, setSelected] = useState<Barber | PublicBusiness | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const load = async () => {
      const current = await getCurrentUser(); const user = current?.userRecord;
      const role = normalizeUserRole(user?.role);
      if (!user || !role || !isInternalRole(user.role)) { window.location.replace(`${baseUrl}login`); return; }
      if (role === DATA.USER_ROLE.SUPERADMIN) { setSession({ user, role, summaries: [] }); return; }
      const ids = userBusinessIds(user);
      if (!ids.length) { setError('Tu cuenta no tiene negocios asignados. Solicita una asignación a superadministración.'); setSession({ user, role, summaries: [] }); return; }
      try {
        const summaries = await getBusinessSummaries(ids);
        const missingIds = ids.filter((id) => !summaries.some((summary) => summary.id === id));
        if (missingIds.length > 0) setError(`No se publicaron los resúmenes de negocio para: ${missingIds.join(', ')}. Podés administrar los negocios disponibles; solicitá a superadministración ejecutar la migración de proyecciones públicas para los identificadores faltantes.`);
        setSession({ user, role, summaries });
      } catch (cause) {
        console.error('Unable to load assigned business summaries:', { ids, cause });
        setError('No fue posible verificar tus negocios asignados. Intenta nuevamente o solicita a superadministración revisar tus asignaciones y las reglas desplegadas.');
        setSession({ user, role, summaries: [] });
      }
    };
    void load();
  }, [baseUrl]);
  const select = (business: Barber | PublicBusiness) => { setSelected(business); const url = new URL(window.location.href); url.searchParams.set('business', business.id); window.history.replaceState(null, '', url); };
  const back = () => { setSelected(null); const url = new URL(window.location.href); url.searchParams.delete('business'); window.history.replaceState(null, '', url); };
  if (!session) return <div className="section-shell flex min-h-screen items-center justify-center"><p className="text-subtle">Verificando acceso...</p></div>;
  if (selected) return <BusinessAdminPage business={selected} role={session.role} staffId={staffIdFor(session.user, selected.id)} onBack={back} onRefresh={() => undefined} />;
  if (session.role === DATA.USER_ROLE.SUPERADMIN) return <SuperAdminApp onSelectBusiness={select} />;
  return <main className="section-shell min-h-screen"><div className="mx-auto max-w-5xl px-4 py-8"><header className="mb-8"><p className="text-xs font-semibold uppercase tracking-widest text-subtle">Administración</p><h1 className="text-3xl font-bold text-main">Elegí un negocio</h1><p className="mt-1 text-sm text-subtle">{session.role === DATA.USER_ROLE.STAFF ? 'Staff · sólo tus asignaciones explícitas.' : 'Storeadmin · sólo los negocios asignados.'}</p></header>{error && <p className="mb-4 rounded-lg p-3 text-sm surface-soft">{error}</p>}<div className="grid gap-4 sm:grid-cols-2">{session.summaries.map((business) => <button key={business.id} type="button" onClick={() => select(business)} className="surface-card rounded-2xl p-5 text-left transition hover:ring-2 hover:ring-(--secondary)"><h2 className="text-lg font-bold text-main">{business.name}</h2><p className="mt-1 text-sm text-subtle">/b/{business.slug}</p><span className="mt-4 inline-block text-sm font-semibold text-(--secondary)">Abrir administración →</span></button>)}</div>{!error && session.summaries.length === 0 && <p className="surface-card rounded-xl p-5 text-sm text-subtle">No hay negocios disponibles para esta cuenta.</p>}</div></main>;
}
