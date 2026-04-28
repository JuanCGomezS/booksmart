import React, { useState } from 'react';
import { updateBarberPlan, toggleBarberActive, getBarberStatus } from '../../../lib/barbers';
import type { Barber, BarberMetrics } from '../../../lib/types';

interface BarbersListProps {
  barbers: Barber[];
  metrics: Record<string, BarberMetrics>;
  onRefresh: () => void;
}

export default function BarbersList({ barbers, metrics, onRefresh }: BarbersListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    plan: string;
    billingCycle: string;
  }>({ plan: 'standard', billingCycle: 'month_1' });
  const [loading, setLoading] = useState(false);

  const formatDate = (date: any): string => {
    if (!date) return '-';
    const d = date instanceof Date ? date : date.toDate?.() || new Date(date);
    return new Intl.DateTimeFormat('es-ES').format(d);
  };

  const getStatusBadge = (barber: Barber) => {
    const status = getBarberStatus(barber);
    const badges = {
      active: 'color-mix(in srgb, #22c55e 20%, transparent)',
      trial: 'color-mix(in srgb, var(--accent) 20%, transparent)',
      expired: 'color-mix(in srgb, #ef4444 20%, transparent)',
    };
    return (
      <span
        className="inline-block px-3 py-1 rounded-full text-sm font-semibold"
        style={{
          background: badges[status],
          border: `1px solid ${status === 'active' ? 'color-mix(in srgb, #22c55e 48%, var(--border))' : status === 'trial' ? 'color-mix(in srgb, var(--accent) 48%, var(--border))' : 'color-mix(in srgb, #ef4444 48%, var(--border))'}`,
          color: status === 'active' ? '#86efac' : status === 'trial' ? 'var(--accent)' : '#fecaca',
        }}
      >
        {status === 'active' && 'Activa'}
        {status === 'trial' && 'Prueba'}
        {status === 'expired' && 'Expirada'}
      </span>
    );
  };

  const handleToggleActive = async (barber: Barber) => {
    if (window.confirm(`¿${barber.active ? 'Desactivar' : 'Activar'} ${barber.name}?`)) {
      setLoading(true);
      try {
        await toggleBarberActive(barber.id, !barber.active);
        onRefresh();
      } catch (err) {
        console.error('Error toggling barber active:', err);
      } finally {
        setLoading(false);
      }
    }
  };

  const handleEditPlan = (barber: Barber) => {
    setEditingId(barber.id);
    setEditForm({
      plan: barber.plan,
      billingCycle: barber.billingCycle,
    });
  };

  const handleSavePlan = async (barberId: string) => {
    if (window.confirm('¿Actualizar plan?')) {
      setLoading(true);
      try {
        await updateBarberPlan(barberId, editForm.plan as any, editForm.billingCycle as any);
        setEditingId(null);
        onRefresh();
      } catch (err) {
        console.error('Error updating plan:', err);
      } finally {
        setLoading(false);
      }
    }
  };

  if (barbers.length === 0) {
    return (
      <div className="surface-card rounded-lg p-8 text-center">
        <p className="text-subtle">No hay barberías registradas aún</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto surface-card rounded-lg">
      <table className="w-full">
        <thead>
          <tr className="table-head">
            <th className="px-6 py-3 text-left text-sm font-semibold text-main">Nombre</th>
            <th className="px-6 py-3 text-left text-sm font-semibold text-main">Estado</th>
            <th className="px-6 py-3 text-left text-sm font-semibold text-main">Plan</th>
            <th className="px-6 py-3 text-left text-sm font-semibold text-main">Expira</th>
            <th className="px-6 py-3 text-left text-sm font-semibold text-main">Métricas</th>
            <th className="px-6 py-3 text-left text-sm font-semibold text-main">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {barbers.map((barber) => (
            <tr key={barber.id} className="table-row transition-colors">
              <td className="px-6 py-4">
                <div>
                  <p className="font-semibold text-main">{barber.name}</p>
                  <p className="text-sm text-subtle">/b/{barber.slug}</p>
                </div>
              </td>
              <td className="px-6 py-4">
                {getStatusBadge(barber)}
              </td>
              <td className="px-6 py-4">
                {editingId === barber.id ? (
                  <div className="space-y-2">
                    <select
                      value={editForm.plan}
                      onChange={(e) => setEditForm({ ...editForm, plan: e.target.value })}
                      disabled={loading}
                      className="field-select text-sm"
                    >
                      <option value="standard">Estándar</option>
                      <option value="plus">Plus</option>
                      <option value="extra">Extra</option>
                    </select>
                    <select
                      value={editForm.billingCycle}
                      onChange={(e) => setEditForm({ ...editForm, billingCycle: e.target.value })}
                      disabled={loading}
                      className="field-select text-sm"
                    >
                      <option value="month_1">1 mes</option>
                      <option value="month_3">3 meses</option>
                      <option value="month_12">12 meses</option>
                    </select>
                  </div>
                ) : (
                  <span className="text-sm text-subtle capitalize">
                    {barber.plan} ({barber.billingCycle === 'month_1' ? '1 mes' : barber.billingCycle === 'month_3' ? '3 meses' : '12 meses'})
                  </span>
                )}
              </td>
              <td className="px-6 py-4">
                <p className="text-sm text-subtle">{formatDate(barber.planExpiresAt)}</p>
              </td>
              <td className="px-6 py-4">
                <div className="text-sm text-subtle space-y-1">
                  <p>Citas: {metrics[barber.id]?.appointmentsThisMonth || 0}</p>
                  <p>Barberos: {metrics[barber.id]?.activeBarbers || 0}</p>
                  <p>Productos: {metrics[barber.id]?.activeProducts || 0}</p>
                </div>
              </td>
              <td className="px-6 py-4">
                <div className="flex gap-2 flex-wrap">
                  {editingId === barber.id ? (
                    <>
                      <button
                        onClick={() => handleSavePlan(barber.id)}
                        disabled={loading}
                        className="btn-primary px-3 py-1 text-xs rounded disabled:opacity-50"
                      >
                        Guardar
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        disabled={loading}
                        className="btn-outline px-3 py-1 text-xs rounded disabled:opacity-50"
                      >
                        Cancelar
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => handleEditPlan(barber)}
                        disabled={loading}
                        className="btn-outline px-3 py-1 text-xs rounded disabled:opacity-50"
                      >
                        Editar plan
                      </button>
                      <button
                        onClick={() => handleToggleActive(barber)}
                        disabled={loading}
                        className={`px-3 py-1 text-xs rounded ${
                          barber.active
                            ? 'btn-outline'
                            : 'btn-primary'
                        } disabled:opacity-50`}
                      >
                        {barber.active ? 'Desactivar' : 'Activar'}
                      </button>
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
