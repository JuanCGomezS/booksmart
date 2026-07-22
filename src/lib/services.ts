import { collection, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import type { Service } from './types';

const SERVICES_CACHE_TTL = 60 * 60 * 1000; // 1 hora

export async function getBarberServices(barberId: string): Promise<Service[]> {
  const cacheKey = `barber_services_${barberId}`;
  const cached = localStorage.getItem(cacheKey);

  if (cached) {
    const { data, expiresAt } = JSON.parse(cached);
    if (Date.now() < expiresAt) {
      return data as Service[];
    }
  }

  try {
    const servicesRef = collection(db, 'barbers', barberId, 'services');
    const servicesDocs = await getDocs(servicesRef);
    const services = servicesDocs.docs.map((serviceDoc) => ({ id: serviceDoc.id, ...serviceDoc.data() } as Service));

    localStorage.setItem(
      cacheKey,
      JSON.stringify({
        data: services,
        expiresAt: Date.now() + SERVICES_CACHE_TTL,
      })
    );

    return services;
  } catch (error) {
    console.error('Error fetching barber services:', error);
    return [];
  }
}
