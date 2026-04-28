import React, { useEffect, useState } from 'react';
import { getAllUsers, updateUserRole } from '../../../lib/users';
import type { User, UserRole } from '../../../lib/types';

const ROLE_OPTIONS: UserRole[] = ['client', 'barber', 'barber_admin', 'superadmin'];

function roleLabel(role: UserRole): string {
  if (role === 'client') return 'Cliente';
  if (role === 'barber') return 'Barbero';
  if (role === 'barber_admin') return 'Administrador barbería';
  return 'Superadministrador';
}

export default function UsersRolesManager() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingUid, setSavingUid] = useState<string | null>(null);
  const [error, setError] = useState('');

  const [draftRoles, setDraftRoles] = useState<Record<string, UserRole>>({});
  const [draftBarberIds, setDraftBarberIds] = useState<Record<string, string>>({});

  const loadUsers = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getAllUsers();
      setUsers(data);

      const roles: Record<string, UserRole> = {};
      const barberIds: Record<string, string> = {};

      for (const user of data) {
        roles[user.uid] = user.role;
        barberIds[user.uid] = user.barberId ?? '';
      }

      setDraftRoles(roles);
      setDraftBarberIds(barberIds);
    } catch (err) {
      setError('No fue posible cargar usuarios');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const saveRole = async (uid: string) => {
    const role = draftRoles[uid];
    const barberId = draftBarberIds[uid]?.trim();

    if ((role === 'barber' || role === 'barber_admin') && !barberId) {
      setError('Barbero y administrador de barbería requieren barberId');
      return;
    }

    setSavingUid(uid);
    setError('');
    try {
      await updateUserRole(uid, role, barberId);
      await loadUsers();
    } catch (err) {
      setError('No fue posible actualizar el rol');
      console.error(err);
    } finally {
      setSavingUid(null);
    }
  };

  if (loading) {
    return (
      <section className="surface-card rounded-lg p-6">
        <p className="text-subtle">Cargando usuarios...</p>
      </section>
    );
  }

  return (
    <section className="surface-card rounded-lg p-6">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-main">Usuarios y roles</h2>
        <p className="text-sm text-subtle">
          Cambia roles desde aquí. Los nuevos registros deben iniciar como cliente.
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg text-sm" style={{ background: 'color-mix(in srgb, #ef4444 14%, var(--surface))', border: '1px solid color-mix(in srgb, #ef4444 45%, var(--border))', color: '#fecaca' }}>
          {error}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="table-head">
              <th className="px-4 py-2 text-left text-sm font-semibold text-main">Email</th>
              <th className="px-4 py-2 text-left text-sm font-semibold text-main">Rol</th>
              <th className="px-4 py-2 text-left text-sm font-semibold text-main">barberId</th>
              <th className="px-4 py-2 text-left text-sm font-semibold text-main">Acción</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const selectedRole = draftRoles[user.uid];
              const requiresBarberId = selectedRole === 'barber' || selectedRole === 'barber_admin';
              const isSaving = savingUid === user.uid;

              return (
                <tr key={user.uid} className="table-row">
                  <td className="px-4 py-3 text-sm text-main">{user.email}</td>
                  <td className="px-4 py-3">
                    <select
                      className="field-select text-sm"
                      value={selectedRole}
                      onChange={(e) => {
                        setDraftRoles((prev) => ({
                          ...prev,
                          [user.uid]: e.target.value as UserRole,
                        }));
                      }}
                      disabled={isSaving}
                    >
                      {ROLE_OPTIONS.map((role) => (
                        <option key={role} value={role}>
                          {roleLabel(role)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <input
                      className="field-input text-sm"
                      placeholder={requiresBarberId ? 'Requerido' : 'No aplica'}
                      value={draftBarberIds[user.uid] ?? ''}
                      onChange={(e) => {
                        setDraftBarberIds((prev) => ({
                          ...prev,
                          [user.uid]: e.target.value,
                        }));
                      }}
                      disabled={isSaving || !requiresBarberId}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <button
                      className="btn-primary px-3 py-1 text-xs rounded disabled:opacity-50"
                      onClick={() => saveRole(user.uid)}
                      disabled={isSaving}
                    >
                      {isSaving ? 'Guardando...' : 'Guardar rol'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
