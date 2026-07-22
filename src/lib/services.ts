import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { loadPublicServices, type PublicServicesCache } from './public-services';
import type { Service } from './types';

export async function getBarberServices(barberId: string): Promise<Service[]> {
  const cacheKey = `barber_services_${barberId}`;
  const cached = localStorage.getItem(cacheKey);

  try {
    const servicesRef = collection(db, 'barbers', barberId, 'services');
    let cache: PublicServicesCache | null = null;
    try { cache = cached ? JSON.parse(cached) as PublicServicesCache : null; } catch { localStorage.removeItem(cacheKey); }
    const result = await loadPublicServices(cache, async () => {
      const servicesDocs = await getDocs(query(servicesRef, where('active', '==', true)));
      return servicesDocs.docs.map((serviceDoc) => ({ id: serviceDoc.id, ...serviceDoc.data() } as Service));
    }, Date.now());
    if (result.cache) localStorage.setItem(cacheKey, JSON.stringify(result.cache));
    return result.services;
  } catch (error) {
    console.error('Error fetching barber services:', error);
    return [];
  }
}
