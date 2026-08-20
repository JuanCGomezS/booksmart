import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebase';

export type BusinessStatistics = {
  startDate: string;
  endDate: string;
  total: number;
  estimatedRevenue: number;
  statuses: Record<'pending' | 'confirmed' | 'done' | 'cancelled' | 'no_show', number>;
  series: Array<{ label: string; total: number; revenue: number }>;
  services: Array<{ serviceId: string; name: string; total: number }>;
  cached: boolean;
};

const CACHE_TTL = 60 * 60 * 1000;
function cacheKey(
  businessId: string,
  startDate: string,
  endDate: string,
  serviceId: string,
  status: string,
) {
  return `business-statistics:v2:${businessId}:${startDate}:${endDate}:${serviceId || 'all'}:${status || 'all'}`;
}

/** Aggregate-only statistics. The browser reads one bounded date range and reuses it for one hour. */
export async function getBusinessStatistics(
  businessId: string,
  startDate: string,
  endDate: string,
  serviceId = '',
  status = '',
): Promise<BusinessStatistics> {
  const key = cacheKey(businessId, startDate, endDate, serviceId, status);
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null') as {
      expiresAt?: number;
      data?: BusinessStatistics;
    } | null;
    if (saved?.data && typeof saved.expiresAt === 'number' && saved.expiresAt > Date.now())
      return { ...saved.data, cached: true };
  } catch {
    localStorage.removeItem(key);
  }

  const [snapshot, servicesSnapshot] = await Promise.all([
    getDocs(query(collection(db, 'barbers', businessId, 'appointments'), where('bookingDate', '>=', startDate), where('bookingDate', '<=', endDate))),
    getDocs(collection(db, 'barbers', businessId, 'services')),
  ]);
  const currentPrices = new Map(servicesSnapshot.docs.map((service) => [service.id, typeof service.data().price === 'number' ? service.data().price : 0]));
  const statuses: BusinessStatistics['statuses'] = { pending: 0, confirmed: 0, done: 0, cancelled: 0, no_show: 0 };
  const byPeriod = new Map<string, { total: number; revenue: number }>();
  const byService = new Map<string, { serviceId: string; name: string; total: number }>();
  let total = 0;
  let estimatedRevenue = 0;
  snapshot.forEach((document) => {
    const item = document.data();
    if (serviceId && item.serviceId !== serviceId) return;
    if (status && item.status !== status) return;
    total += 1;
    if (item.status in statuses) statuses[item.status as keyof BusinessStatistics['statuses']] += 1;
    const revenue = item.status === 'done' ? (typeof item.servicePrice === 'number' ? item.servicePrice : currentPrices.get(item.serviceId) || 0) : 0;
    estimatedRevenue += revenue;
    if (typeof item.bookingDate === 'string') {
      const entry = byPeriod.get(item.bookingDate) || { total: 0, revenue: 0 };
      entry.total += 1; entry.revenue += revenue; byPeriod.set(item.bookingDate, entry);
    }
    const id = typeof item.serviceId === 'string' ? item.serviceId : 'unknown';
    const entry = byService.get(id) || { serviceId: id, name: typeof item.serviceName === 'string' ? item.serviceName : 'Servicio sin nombre', total: 0 };
    entry.total += 1; byService.set(id, entry);
  });
  const days = Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000);
  const series = days <= 31
    ? Array.from({ length: days + 1 }, (_, index) => { const date = new Date(`${startDate}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + index); const key = date.toISOString().slice(0, 10); const value = byPeriod.get(key) || { total: 0, revenue: 0 }; return { label: key.slice(5), ...value }; })
    : Array.from({ length: (new Date(`${endDate}T00:00:00Z`).getUTCFullYear() - new Date(`${startDate}T00:00:00Z`).getUTCFullYear()) * 12 + new Date(`${endDate}T00:00:00Z`).getUTCMonth() - new Date(`${startDate}T00:00:00Z`).getUTCMonth() + 1 }, (_, index) => {
      const date = new Date(`${startDate}T00:00:00Z`); date.setUTCMonth(date.getUTCMonth() + index); const key = date.toISOString().slice(0, 7); const totals = [...byPeriod.entries()].filter(([day]) => day.startsWith(key)).reduce((sum, [, value]) => ({ total: sum.total + value.total, revenue: sum.revenue + value.revenue }), { total: 0, revenue: 0 }); return { label: key, ...totals };
    });
  const data: BusinessStatistics = {
    startDate,
    endDate,
    total,
    estimatedRevenue,
    statuses,
    series,
    services: [...byService.values()].sort((a, b) => b.total - a.total).slice(0, 12),
    cached: false,
  };
  localStorage.setItem(key, JSON.stringify({ expiresAt: Date.now() + CACHE_TTL, data }));
  return data;
}
