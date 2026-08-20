import React, { useEffect, useState } from 'react';
import { getBusinessStatistics, type BusinessStatistics } from '../../../lib/business-statistics';

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}
function monthStart(date = new Date()) {
  return `${isoDate(date).slice(0, 7)}-01`;
}

const statusLabel: Record<keyof BusinessStatistics['statuses'], string> = {
  pending: 'Pendientes',
  confirmed: 'Confirmadas',
  done: 'Completadas',
  cancelled: 'Canceladas',
  no_show: 'No asistió',
};

export default function BusinessStatisticsPanel({ businessId }: { businessId: string }) {
  const today = isoDate(new Date());
  const [startDate, setStartDate] = useState(monthStart());
  const [endDate, setEndDate] = useState(today);
  const [serviceId, setServiceId] = useState('');
  const [status, setStatus] = useState('');
  const [data, setData] = useState<BusinessStatistics | null>(null);
  const [services, setServices] = useState<BusinessStatistics['services']>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const next = await getBusinessStatistics(businessId, startDate, endDate, serviceId, status);
      setData(next);
      setServices((current) => (current.length ? current : next.services));
    } catch {
      setError('No fue posible cargar las estadísticas. Revisa el rango e inténtalo nuevamente.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []); // Initial data is cached by the callable for one hour.
  const max = Math.max(1, ...(data?.series.map((item) => item.total) || [0]));
  const money = (value: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value);

  return (
    <section className="surface-card rounded-2xl p-6" aria-labelledby="statistics-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="statistics-title" className="text-xl font-bold text-main">
            Estadísticas
          </h2>
        </div>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-5">
        <label className="field-label">
          Desde
          <input
            className="field-input mt-1"
            type="date"
            value={startDate}
            max={endDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </label>
        <label className="field-label">
          Hasta
          <input
            className="field-input mt-1"
            type="date"
            value={endDate}
            min={startDate}
            max={today}
            onChange={(event) => setEndDate(event.target.value)}
          />
        </label>
        <label className="field-label">
          Servicio
          <select
            className="field-input mt-1"
            value={serviceId}
            onChange={(event) => setServiceId(event.target.value)}
          >
            <option value="">Todos los servicios</option>
            {services.map((service) => (
              <option key={service.serviceId} value={service.serviceId}>
                {service.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field-label">
          Estado
          <select
            className="field-input mt-1"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">Todos los estados</option>
            {(Object.keys(statusLabel) as Array<keyof BusinessStatistics['statuses']>).map(
              (key) => (
                <option key={key} value={key}>
                  {statusLabel[key]}
                </option>
              ),
            )}
          </select>
        </label>
        <div className="flex items-end">
          <button
            type="button"
            className="btn-primary w-full rounded px-4 py-2"
            disabled={loading}
            onClick={() => void load()}
          >
            {loading ? 'Consultando…' : 'Aplicar filtros'}
          </button>
        </div>
      </div>
      {error && (
        <p className="error-message mt-4 text-sm" role="alert">
          {error}
        </p>
      )}
      {data && (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-4">
            <article className="surface-soft rounded-xl p-4">
              <p className="text-sm text-subtle">Total de citas</p>
              <p className="mt-1 text-3xl font-bold text-main">{data.total}</p>
            </article>
            <article className="surface-soft rounded-xl p-4">
              <p className="text-sm text-subtle">Ingresos realizados</p>
              <p className="mt-1 text-2xl font-bold text-main">{money(data.estimatedRevenue)}</p>
              <p className="mt-1 text-xs text-subtle">Solo citas completadas.</p>
            </article>
            <article className="surface-soft rounded-xl p-4">
              <p className="text-sm text-subtle">Completadas</p>
              <p className="mt-1 text-3xl font-bold text-main">{data.statuses.done}</p>
            </article>
            <article className="surface-soft rounded-xl p-4">
              <p className="text-sm text-subtle">Pendientes y confirmadas</p>
              <p className="mt-1 text-3xl font-bold text-main">
                {data.statuses.pending + data.statuses.confirmed}
              </p>
            </article>
          </div>
          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div>
              <h3 className="font-semibold text-main">Citas e ingresos por período</h3>
              <div className="mt-3 flex h-40 items-end gap-1 border-b border-(--border) pb-1">
                {data.series.map((item) => (
                  <div
                    key={item.label}
                    className="group relative min-w-1 flex-1 bg-(--secondary)"
                    style={{ height: `${Math.max(3, (item.total / max) * 100)}%` }}
                    title={`${item.label}: ${item.total} citas · ${money(item.revenue)}`}
                  >
                    <span className="sr-only">
                      {item.label}: {item.total}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex justify-between text-xs text-subtle">
                <span>{data.series[0]?.label}</span>
                <span>{data.series.at(-1)?.label}</span>
              </div>
            </div>
            <div>
              <h3 className="font-semibold text-main">Estados</h3>
              <dl className="mt-3 space-y-2">
                {(Object.keys(statusLabel) as Array<keyof BusinessStatistics['statuses']>).map(
                  (status) => (
                    <div
                      key={status}
                      className="flex justify-between border-b border-(--border) pb-2 text-sm"
                    >
                      <dt className="text-subtle">{statusLabel[status]}</dt>
                      <dd className="font-semibold text-main">{data.statuses[status]}</dd>
                    </div>
                  ),
                )}
              </dl>
            </div>
          </div>
          {data.services.length > 0 && (
            <div className="mt-6">
              <h3 className="font-semibold text-main">Servicios más solicitados</h3>
              <ol className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {data.services.map((service) => (
                  <li
                    key={service.serviceId}
                    className="surface-soft flex justify-between rounded-lg px-3 py-2 text-sm"
                  >
                    <span className="truncate text-subtle">{service.name}</span>
                    <strong className="ml-3 text-main">{service.total}</strong>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </>
      )}
    </section>
  );
}
