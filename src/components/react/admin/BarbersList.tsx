import React, { useState } from 'react';
import { updateBarberPlan, toggleBarberActive, getBarberStatus, deleteBarber } from '../../../lib/barbers';
import type { Barber } from '../../../lib/types';
import { BARBER_STATUS_LABEL, BILLING_CYCLE_LABEL, DATA, PLAN_LABEL } from '../../../lib/data';
import ConfirmModal from '../ConfirmModal';
import FancySelect, { type FancySelectOption } from '../FancySelect';

interface BarbersListProps {
  barbers: Barber[];
  onRefresh: () => void;
}

interface ConfirmAction {
  type: typeof DATA.CONFIRM_ACTION[keyof typeof DATA.CONFIRM_ACTION];
  barberId: string;
  barberName: string;
  action?: () => Promise<unknown>;
}

const PLAN_OPTIONS: FancySelectOption<string>[] = [
  { value: DATA.PLAN.STANDARD, label: PLAN_LABEL[DATA.PLAN.STANDARD] },
  { value: DATA.PLAN.PLUS, label: PLAN_LABEL[DATA.PLAN.PLUS] },
  { value: DATA.PLAN.EXTRA, label: PLAN_LABEL[DATA.PLAN.EXTRA] },
];

const BILLING_OPTIONS: FancySelectOption<string>[] = [
  { value: DATA.BILLING_CYCLE.MONTH_1, label: BILLING_CYCLE_LABEL[DATA.BILLING_CYCLE.MONTH_1] },
  { value: DATA.BILLING_CYCLE.MONTH_3, label: BILLING_CYCLE_LABEL[DATA.BILLING_CYCLE.MONTH_3] },
  { value: DATA.BILLING_CYCLE.MONTH_12, label: BILLING_CYCLE_LABEL[DATA.BILLING_CYCLE.MONTH_12] },
];

export default function BarbersList({ barbers, onRefresh }: BarbersListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    plan: string;
    billingCycle: string;
  }>({ plan: 'standard', billingCycle: 'month_1' });
  const [loading, setLoading] = useState(false);
  const [adminModalBarber, setAdminModalBarber] = useState<Barber | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ isOpen: boolean; action: ConfirmAction | null }>({
    isOpen: false,
    action: null,
  });

  const formatDate = (date: any): string => {
    if (!date) return '-';
    const d = date instanceof Date ? date : date.toDate?.() || new Date(date);
    return new Intl.DateTimeFormat('es-ES').format(d);
  };

  const getStatusBadge = (barber: Barber) => {
    const status = getBarberStatus(barber);
    const badges = {
      [DATA.BARBER_STATUS.ACTIVE]: 'color-mix(in srgb, #22c55e 20%, transparent)',
      [DATA.BARBER_STATUS.TRIAL]: 'color-mix(in srgb, var(--accent) 20%, transparent)',
      [DATA.BARBER_STATUS.EXPIRED]: 'color-mix(in srgb, #ef4444 20%, transparent)',
    };
    return (
      <span
        className="inline-block px-3 py-1 rounded-full text-sm font-semibold"
        style={{
          background: badges[status],
          border: `1px solid ${status === DATA.BARBER_STATUS.ACTIVE ? 'color-mix(in srgb, #22c55e 48%, var(--border))' : status === DATA.BARBER_STATUS.TRIAL ? 'color-mix(in srgb, var(--accent) 48%, var(--border))' : 'color-mix(in srgb, #ef4444 48%, var(--border))'}`,
          color: status === DATA.BARBER_STATUS.ACTIVE ? '#86efac' : status === DATA.BARBER_STATUS.TRIAL ? 'var(--accent)' : '#fecaca',
        }}
      >
        {BARBER_STATUS_LABEL[status]}
      </span>
    );
  };

  const handleToggleActive = (barber: Barber) => {
    setConfirmModal({
      isOpen: true,
      action: {
        type: DATA.CONFIRM_ACTION.TOGGLE,
        barberId: barber.id,
        barberName: barber.name,
        action: () => toggleBarberActive(barber.id, !barber.active),
      },
    });
  };

  const handleEditPlan = (barber: Barber) => {
    setEditingId(barber.id);
    setEditForm({
      plan: barber.plan,
      billingCycle: barber.billingCycle,
    });
  };

  const handleSavePlan = (barberId: string) => {
    setConfirmModal({
      isOpen: true,
      action: {
        type: DATA.CONFIRM_ACTION.UPDATE_PLAN,
        barberId,
        barberName: barbers.find(b => b.id === barberId)?.name || 'Barbería',
        action: () => updateBarberPlan(barberId, editForm.plan as any, editForm.billingCycle as any),
      },
    });
  };

  const handleDeleteBarber = (barber: Barber) => {
    setConfirmModal({
      isOpen: true,
      action: {
        type: DATA.CONFIRM_ACTION.DELETE,
        barberId: barber.id,
        barberName: barber.name,
        action: () => deleteBarber(barber.id),
      },
    });
  };

  const handleConfirmAction = async () => {
    if (!confirmModal.action) return;
    const action = confirmModal.action;

    setLoading(true);
    try {
      await action.action?.();
      setConfirmModal({ isOpen: false, action: null });

      if (action.type === DATA.CONFIRM_ACTION.UPDATE_PLAN) {
        setEditingId(null);
      }

      onRefresh();
    } catch (err) {
      console.error('Error executing action:', err);
    } finally {
      setLoading(false);
    }
  };

  const getConfirmMessage = (): { title: string; message: string; isDangerous: boolean } => {
    if (!confirmModal.action) return { title: '', message: '', isDangerous: false };
    const { type, barberName } = confirmModal.action;

    switch (type) {
      case DATA.CONFIRM_ACTION.DELETE:
        return {
          title: 'Eliminar barbería',
          message: `¿Estás seguro de que quieres eliminar "${barberName}"? Esta acción no se puede deshacer.`,
          isDangerous: true,
        };
      case DATA.CONFIRM_ACTION.TOGGLE:
        return {
          title: 'Cambiar estado',
          message: `¿Cambiar estado de "${barberName}"?`,
          isDangerous: false,
        };
      case DATA.CONFIRM_ACTION.UPDATE_PLAN:
        return {
          title: 'Actualizar plan',
          message: `¿Actualizar el plan de "${barberName}"?`,
          isDangerous: false,
        };
      default:
        return { title: '', message: '', isDangerous: false };
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
    <>
    <div className="overflow-x-auto surface-card rounded-lg">
      <table className="w-full">
        <thead>
          <tr className="table-head">
            <th className="px-6 py-3 text-left text-sm font-semibold text-main">Nombre</th>
            <th className="px-6 py-3 text-left text-sm font-semibold text-main">Administrador</th>
            <th className="px-6 py-3 text-left text-sm font-semibold text-main">Estado</th>
            <th className="px-6 py-3 text-left text-sm font-semibold text-main">Plan</th>
            <th className="px-6 py-3 text-left text-sm font-semibold text-main">Expira</th>
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
                <p className="text-sm text-main">{barber.ownerEmail || 'N/A'}</p>
              </td>
              <td className="px-6 py-4">
                {getStatusBadge(barber)}
              </td>
              <td className="px-6 py-4">
                {editingId === barber.id ? (
                  <div className="space-y-2">
                    <FancySelect
                      value={editForm.plan}
                      onChange={(value) => setEditForm({ ...editForm, plan: value })}
                      options={PLAN_OPTIONS}
                      disabled={loading}
                      buttonClassName="text-sm"
                    />
                    <FancySelect
                      value={editForm.billingCycle}
                      onChange={(value) => setEditForm({ ...editForm, billingCycle: value })}
                      options={BILLING_OPTIONS}
                      disabled={loading}
                      buttonClassName="text-sm"
                    />
                  </div>
                ) : (
                  <span className="text-sm text-subtle capitalize">
                    {barber.plan} ({BILLING_CYCLE_LABEL[barber.billingCycle]})
                  </span>
                )}
              </td>
              <td className="px-6 py-4">
                <p className="text-sm text-subtle">{formatDate(barber.planExpiresAt)}</p>
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
                        onClick={() => setAdminModalBarber(barber)}
                        disabled={loading}
                        className="btn-primary px-3 py-1 text-xs rounded disabled:opacity-50"
                      >
                        Administrar
                      </button>
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
                        className="btn-outline px-3 py-1 text-xs rounded disabled:opacity-50"
                      >
                        {barber.active ? 'Desactivar' : 'Activar'}
                      </button>
                      <button
                        onClick={() => handleDeleteBarber(barber)}
                        disabled={loading}
                        className="px-3 py-1 text-xs rounded disabled:opacity-50"
                        style={{ background: 'color-mix(in srgb, #ef4444 18%, var(--surface))', border: '1px solid color-mix(in srgb, #ef4444 45%, var(--border))', color: '#fca5a5' }}
                      >
                        Eliminar
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

    {/* Modal administración de barbería */}
    {adminModalBarber && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ background: 'rgba(0,0,0,0.6)' }}
        onClick={(e) => { if (e.target === e.currentTarget) setAdminModalBarber(null); }}
      >
        <div className="surface-card w-full max-w-2xl rounded-2xl p-6 shadow-2xl">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-subtle">Administración</p>
              <h2 className="text-2xl font-bold text-main">{adminModalBarber.name}</h2>
              <p className="text-sm text-subtle">/b/{adminModalBarber.slug}</p>
            </div>
            <button
              onClick={() => setAdminModalBarber(null)}
              className="text-subtle hover:text-main transition-colors text-xl leading-none"
              aria-label="Cerrar"
            >
              ✕
            </button>
          </div>

          <div className="flex items-center justify-center py-16 rounded-xl" style={{ border: '2px dashed var(--border)' }}>
            <div className="text-center">
              <p className="text-subtle text-sm">Panel de administración de barbería</p>
              <p className="text-xs text-subtle mt-1 opacity-60">Disponible en la Etapa 5</p>
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <button
              onClick={() => setAdminModalBarber(null)}
              className="btn-outline px-6 py-2 rounded-xl text-sm font-semibold"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    )}
    
    <ConfirmModal
      isOpen={confirmModal.isOpen}
      title={getConfirmMessage().title}
      message={getConfirmMessage().message}
      isDangerous={getConfirmMessage().isDangerous}
      confirmText="Aceptar"
      cancelText="Cancelar"
      onConfirm={handleConfirmAction}
      onCancel={() => setConfirmModal({ isOpen: false, action: null })}
    />
    </>
  );
}
