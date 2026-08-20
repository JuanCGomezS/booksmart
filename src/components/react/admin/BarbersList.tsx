import React from 'react';
import { getBarberStatus } from '../../../lib/barbers';
import type { Barber } from '../../../lib/types';
import {
  BARBER_STATUS_LABEL,
  BILLING_CYCLE_LABEL,
  BUSINESS_TYPE_LABEL,
  DATA,
  PLAN_LABEL,
} from '../../../lib/data';

interface BarbersListProps {
  barbers: Barber[];
  onRefresh: () => void;
  onSelect: (barber: Barber) => void;
}

export default function BarbersList({ barbers, onSelect }: BarbersListProps) {
  if (barbers.length === 0) {
    return (
      <div className="super-admin-surface surface-card p-8 text-center">
        <p className="text-subtle">No hay negocios registrados aún</p>
      </div>
    );
  }

  return (
    <>
      <div className="super-admin-surface super-admin-table-surface overflow-x-auto surface-card">
        <table className="w-full">
          <thead>
            <tr className="table-head">
              <th className="px-6 py-3 text-left text-sm font-semibold text-main">Negocio</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-main">Tipo</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-main">Administrador</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-main">Estado</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-main">Plan</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-main">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {barbers.map((barber) => {
              const status = getBarberStatus(barber);
              const statusClass =
                status === DATA.BARBER_STATUS.ACTIVE
                  ? 'status-active'
                  : status === DATA.BARBER_STATUS.TRIAL
                    ? 'status-trial'
                    : 'status-inactive';
              return (
                <tr key={barber.id} className="table-row transition-colors">
                  <td className="px-6 py-4">
                    <p className="font-semibold text-main">{barber.name}</p>
                    <p className="text-sm text-subtle">/b/{barber.slug}</p>
                  </td>
                  <td className="px-6 py-4 text-sm text-subtle">
                    {BUSINESS_TYPE_LABEL[barber.businessType]}
                  </td>
                  <td className="px-6 py-4 text-sm text-main">{barber.ownerEmail || 'N/A'}</td>
                  <td className="px-6 py-4">
                    <span
                      className={`status-badge ${statusClass} inline-block rounded-full px-3 py-1 text-sm font-semibold`}
                    >
                      {BARBER_STATUS_LABEL[status]}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-subtle">
                    {PLAN_LABEL[barber.plan]} ({BILLING_CYCLE_LABEL[barber.billingCycle]})
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => onSelect(barber)}
                        className="btn-primary super-admin-action px-3 py-1 text-xs"
                      >
                        Administrar
                      </button>
                      <a
                        href={`${import.meta.env.BASE_URL}b/${encodeURIComponent(barber.slug)}`}
                        target="_blank"
                        className="btn-outline super-admin-outline px-3 py-1 text-xs"
                      >
                        Ver
                      </a>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
