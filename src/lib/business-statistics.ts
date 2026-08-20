import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebase';

export type BusinessStatistics = {
  startDate: string;
  endDate: string;
  total: number;
  statuses: Record<'pending' | 'confirmed' | 'done' | 'cancelled' | 'no_show', number>;
  series: Array<{ label: string; total: number }>;
  services: Array<{ serviceId: string; name: string; total: number }>;
  cached: boolean;
};

const CACHE_TTL = 60 * 60 * 1000;
function cacheKey(businessId: string, startDate: string, endDate: string, serviceId: string, status: string) {
  return `business-statistics:v1:${businessId}:${startDate}:${endDate}:${serviceId || 'all'}:${status || 'all'}`;
}

/** Aggregate-only statistics. The browser reads one bounded date range and reuses it for one hour. */
export async function getBusinessStatistics(businessId: string, startDate: string, endDate: string, serviceId = '', status = ''): Promise<BusinessStatistics> {
  const key = cacheKey(businessId, startDate, endDate, serviceId, status);
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null') as { expiresAt?: number; data?: BusinessStatistics } | null;
    if (saved?.data && typeof saved.expiresAt === 'number' && saved.expiresAt > Date.now()) return { ...saved.data, cached: true };
  } catch { localStorage.removeItem(key); }

  const snapshot = await getDocs(query(
    collection(db, 'barbers', businessId, 'appointments'),
    where('bookingDate', '>=', startDate),
    where('bookingDate', '<=', endDate),
  ));
  const statuses: BusinessStatistics['statuses'] = { pending: 0, confirmed: 0, done: 0, cancelled: 0, no_show: 0 };
  const byDate = new Map<string, number>();
  const byService = new Map<string, { serviceId: string; name: string; total: number }>();
  let total = 0;
  snapshot.forEach((document) => {
    const item = document.data();
    if (serviceId && item.serviceId !== serviceId) return;
    if (status && item.status !== status) return;
    total += 1;
    if (item.status in statuses) statuses[item.status as keyof BusinessStatistics['statuses']] += 1;
    if (typeof item.bookingDate === 'string') byDate.set(item.bookingDate, (byDate.get(item.bookingDate) || 0) + 1);
    const id = typeof item.serviceId === 'string' ? item.serviceId : 'unknown';
    const entry = byService.get(id) || { serviceId: id, name: typeof item.serviceName === 'string' ? item.serviceName : 'Servicio sin nombre', total: 0 };
    entry.total += 1;
    byService.set(id, entry);
  });
  const days = Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000);
  const series = days <= 31
    ? Array.from({ length: days + 1 }, (_, index) => { const date = new Date(`${startDate}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + index); const day = date.toISOString().slice(0, 10); return { label: day.slice(5), total: byDate.get(day) || 0 }; })
    : [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, value]) => ({ label, total: value }));
  const data: BusinessStatistics = { startDate, endDate, total, statuses, series, services: [...byService.values()].sort((a, b) => b.total - a.total).slice(0, 12), cached: false };
  localStorage.setItem(key, JSON.stringify({ expiresAt: Date.now() + CACHE_TTL, data }));
  return data;
}
