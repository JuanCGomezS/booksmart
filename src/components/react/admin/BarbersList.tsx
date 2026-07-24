import React from 'react';
import { getBarberStatus } from '../../../lib/barbers';
import type { Barber } from '../../../lib/types';
import { BARBER_STATUS_LABEL, BILLING_CYCLE_LABEL, BUSINESS_TYPE_LABEL, DATA, PLAN_LABEL } from '../../../lib/data';

interface BarbersListProps {
  barbers: Barber[];
  onRefresh: () => void;
  onSelect: (barber: Barber) => void;
}

export default function BarbersList({ barbers, onSelect }: BarbersListProps) {

  if (barbers.length === 0) {
    return <div className="surface-card rounded-lg p-8 text-center"><p className="text-subtle">No hay negocios registrados aún</p></div>;
  }

  return (
    <>
      <div className="overflow-x-auto surface-card rounded-lg">
        <table className="w-full">
          <thead><tr className="table-head"><th className="px-6 py-3 text-left text-sm font-semibold text-main">Negocio</th><th className="px-6 py-3 text-left text-sm font-semibold text-main">Tipo</th><th className="px-6 py-3 text-left text-sm font-semibold text-main">Administrador</th><th className="px-6 py-3 text-left text-sm font-semibold text-main">Estado</th><th className="px-6 py-3 text-left text-sm font-semibold text-main">Plan</th><th className="px-6 py-3 text-left text-sm font-semibold text-main">Acciones</th></tr></thead>
          <tbody>{barbers.map((barber) => {
            const status = getBarberStatus(barber);
            return <tr key={barber.id} className="table-row transition-colors"><td className="px-6 py-4"><p className="font-semibold text-main">{barber.name}</p><p className="text-sm text-subtle">/b/{barber.slug}</p></td><td className="px-6 py-4 text-sm text-subtle">{BUSINESS_TYPE_LABEL[barber.businessType]}</td><td className="px-6 py-4 text-sm text-main">{barber.ownerEmail || 'N/A'}</td><td className="px-6 py-4"><span className="inline-block rounded-full px-3 py-1 text-sm font-semibold" style={{ background: status === DATA.BARBER_STATUS.ACTIVE ? 'color-mix(in srgb, #22c55e 20%, transparent)' : status === DATA.BARBER_STATUS.TRIAL ? 'color-mix(in srgb, var(--accent) 20%, transparent)' : 'color-mix(in srgb, #ef4444 20%, transparent)', color: status === DATA.BARBER_STATUS.ACTIVE ? '#86efac' : status === DATA.BARBER_STATUS.TRIAL ? 'var(--accent)' : '#fecaca' }}>{BARBER_STATUS_LABEL[status]}</span></td><td className="px-6 py-4 text-sm text-subtle">{PLAN_LABEL[barber.plan]} ({BILLING_CYCLE_LABEL[barber.billingCycle]})</td><td className="px-6 py-4"><div className="flex flex-wrap gap-2"><button type="button" onClick={() => onSelect(barber)} className="btn-primary rounded px-3 py-1 text-xs">Administrar</button><a href={`${import.meta.env.BASE_URL}b/${encodeURIComponent(barber.slug)}`} className="btn-outline rounded px-3 py-1 text-xs">Ver</a></div></td></tr>;
          })}</tbody>
        </table>
      </div>
    </>
  );
}
