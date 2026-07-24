import React, { useEffect, useState } from 'react';
import { DATA, USER_ROLE_LABEL } from '../../../lib/data';
import { getAllUsers, getBusinessAssignmentOptions, updateUserRole } from '../../../lib/users';
import { normalizeUserRole } from '../../../lib/roles';
import type { BusinessAssignmentOption, User, UserRole } from '../../../lib/types';
import FancySelect, { type FancySelectOption } from '../FancySelect';

const ROLE_OPTIONS: UserRole[] = [DATA.USER_ROLE.CUSTOMER, DATA.USER_ROLE.STAFF, DATA.USER_ROLE.STOREADMIN, DATA.USER_ROLE.SUPERADMIN];
const ROLE_SELECT_OPTIONS: FancySelectOption<UserRole>[] = ROLE_OPTIONS.map((role) => ({ value: role, label: USER_ROLE_LABEL[role] }));

function businessIdsFor(user: User): string[] {
  return [...new Set([...(user.businessIds || []), user.barberId || ''].filter(Boolean))];
}

function BusinessSelector({
  user,
  businessIds,
  businesses,
  disabled,
  onChange,
}: {
  user: User;
  businessIds: string[];
  businesses: BusinessAssignmentOption[];
  disabled: boolean;
  onChange: (businessIds: string[]) => void;
}) {
  const role = normalizeUserRole(user.role);
  const applies = role === DATA.USER_ROLE.STOREADMIN || role === DATA.USER_ROLE.STAFF;
  const selected = new Set(businessIds);
  const available = businesses.filter((business) => !selected.has(business.id));
  const labels = new Map(businesses.map((business) => [business.id, business.name]));

  if (!applies) return <p className="text-sm text-subtle">No aplica</p>;

  return <div className="min-w-64 space-y-2">
    <label className="sr-only" htmlFor={`business-${user.uid}`}>Agregar negocio para {user.email}</label>
    <select
      id={`business-${user.uid}`}
      className="field-input w-full text-sm"
      disabled={disabled || available.length === 0}
      value=""
      onChange={(event) => {
        if (event.target.value) onChange([...businessIds, event.target.value]);
      }}
    >
      <option value="">{available.length ? 'Agregar negocio…' : 'No hay más negocios para agregar'}</option>
      {available.map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}
    </select>
    {businessIds.length > 0 ? <ul className="flex flex-wrap gap-1" aria-label={`Negocios asignados a ${user.email}`}>
      {businessIds.map((businessId) => <li key={businessId} className="flex items-center gap-1 rounded-full px-2 py-1 text-xs surface-soft">
        <span>{labels.get(businessId) || 'Negocio no disponible'}</span>
        <button type="button" className="font-bold text-subtle hover:text-main disabled:opacity-50" disabled={disabled} onClick={() => onChange(businessIds.filter((id) => id !== businessId))} aria-label={`Quitar ${labels.get(businessId) || 'negocio no disponible'}`}>×</button>
      </li>)}
    </ul> : <p className="text-sm text-subtle">Sin negocios asignados.</p>}
  </div>;
}

export default function UsersRolesManager() {
  const [users, setUsers] = useState<User[]>([]);
  const [businesses, setBusinesses] = useState<BusinessAssignmentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingUid, setSavingUid] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [draftRoles, setDraftRoles] = useState<Record<string, UserRole>>({});
  const [draftBusinessIds, setDraftBusinessIds] = useState<Record<string, string[]>>({});

  const loadUsers = async () => {
    setLoading(true); setError('');
    try {
      const data = await getAllUsers();
      setUsers(data);
      setDraftRoles(Object.fromEntries(data.map((user) => [user.uid, normalizeUserRole(user.role) || DATA.USER_ROLE.CUSTOMER])));
      setDraftBusinessIds(Object.fromEntries(data.map((user) => [user.uid, businessIdsFor(user)])));
    } catch (cause) { console.error(cause); setError('No fue posible cargar usuarios.'); } finally { setLoading(false); }
  };

  useEffect(() => {
    void Promise.all([loadUsers(), getBusinessAssignmentOptions()])
      .then(([, options]) => setBusinesses(options))
      .catch((cause) => { console.error(cause); setError('No fue posible cargar los negocios para asignación.'); });
  }, []);

  const saveRole = async (uid: string) => {
    const role = draftRoles[uid];
    const businessIds = draftBusinessIds[uid] || [];
    if ((role === DATA.USER_ROLE.STOREADMIN || role === DATA.USER_ROLE.STAFF) && businessIds.length === 0) {
      setError(`${USER_ROLE_LABEL[role]} requiere al menos un negocio.`);
      return;
    }
    setSavingUid(uid); setError('');
    try {
      await updateUserRole(uid, role, businessIds);
      await loadUsers();
    } catch (cause) {
      console.error(cause);
      setError('No fue posible actualizar el rol o los negocios.');
    } finally { setSavingUid(null); }
  };

  if (loading) return <section className="surface-card rounded-lg p-6"><p className="text-subtle">Cargando usuarios...</p></section>;
  return <section className="surface-card rounded-2xl p-6 md:p-7">
    <div className="mb-4"><h2 className="text-xl font-bold text-main">Usuarios, roles y asignaciones</h2><p className="text-sm text-subtle">Selecciona negocios por nombre. Para Personal, el vínculo interno con su registro se conserva o se crea automáticamente.</p></div>
    {error && <div className="mb-4 rounded-lg p-3 text-sm" style={{ background: 'color-mix(in srgb, #ef4444 14%, var(--surface))', color: '#fecaca' }}>{error}</div>}
    <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--border)' }}><table className="w-full"><thead><tr className="table-head"><th className="px-4 py-2 text-left text-sm font-semibold text-main">Email</th><th className="px-4 py-2 text-left text-sm font-semibold text-main">Rol</th><th className="px-4 py-2 text-left text-sm font-semibold text-main">Negocios</th><th className="px-4 py-2 text-left text-sm font-semibold text-main">Acción</th></tr></thead><tbody>
      {users.map((user) => { const role = draftRoles[user.uid]; const saving = savingUid === user.uid; return <tr key={user.uid} className="table-row"><td className="px-4 py-3 text-sm text-main">{user.email}</td><td className="px-4 py-3"><FancySelect className="min-w-52" buttonClassName="text-sm" value={role} options={ROLE_SELECT_OPTIONS} disabled={saving} onChange={(next) => setDraftRoles((draft) => ({ ...draft, [user.uid]: next }))} /></td><td className="px-4 py-3"><BusinessSelector user={{ ...user, role }} businessIds={draftBusinessIds[user.uid] || []} businesses={businesses} disabled={saving} onChange={(businessIds) => setDraftBusinessIds((draft) => ({ ...draft, [user.uid]: businessIds }))} /></td><td className="px-4 py-3"><button className="btn-primary rounded px-3 py-1 text-xs disabled:opacity-50" disabled={saving} onClick={() => void saveRole(user.uid)}>{saving ? 'Guardando...' : 'Guardar'}</button></td></tr>; })}
    </tbody></table></div>
  </section>;
}
