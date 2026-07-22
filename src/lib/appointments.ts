import {
  addDoc,
  collection,
  getDocs,
  query,
  serverTimestamp,
  Timestamp,
  where,
} from 'firebase/firestore';
import { db } from './firebase';
import type { Appointment, BarberStaff } from './types';

const STAFF_CACHE_TTL = 30 * 60 * 1000; // 30 min

export interface CreateAppointmentInput {
  clientName: string;
  clientPhone: string;
  staffId: string;
  serviceId: string;
  extraServices: string[];
  date: Date;
  durationMinutes: number;
  notes?: string;
}

export async function getActiveBarberStaff(barberId: string): Promise<BarberStaff[]> {
  const cacheKey = `barber_staff_${barberId}`;
  const cached = localStorage.getItem(cacheKey);

  if (cached) {
    const { data, expiresAt } = JSON.parse(cached);
    if (Date.now() < expiresAt) {
      return data as BarberStaff[];
    }
  }

  try {
    const staffRef = collection(db, 'barbers', barberId, 'barbers');
    const staffQuery = query(staffRef, where('active', '==', true));
    const staffDocs = await getDocs(staffQuery);
    const staff = staffDocs.docs.map((staffDoc) => ({ id: staffDoc.id, ...staffDoc.data() } as BarberStaff));

    localStorage.setItem(
      cacheKey,
      JSON.stringify({
        data: staff,
        expiresAt: Date.now() + STAFF_CACHE_TTL,
      })
    );

    return staff;
  } catch (error) {
    console.error('Error fetching barber staff:', error);
    return [];
  }
}

export async function getAppointmentsForStaffAndDate(
  barberId: string,
  staffId: string,
  date: Date
): Promise<Appointment[]> {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);

  try {
    const appointmentsRef = collection(db, 'barbers', barberId, 'appointments');
    const appointmentsQuery = query(
      appointmentsRef,
      where('barberId', '==', staffId),
      where('date', '>=', Timestamp.fromDate(start)),
      where('date', '<=', Timestamp.fromDate(end))
    );
    const appointmentsDocs = await getDocs(appointmentsQuery);

    return appointmentsDocs.docs.map((appointmentDoc) => ({
      id: appointmentDoc.id,
      ...appointmentDoc.data(),
    } as Appointment));
  } catch (error) {
    console.error('Error fetching appointments by staff/day:', error);
    return [];
  }
}

export async function createPublicAppointment(
  barberId: string,
  input: CreateAppointmentInput
): Promise<string | null> {
  try {
    const appointmentsRef = collection(db, 'barbers', barberId, 'appointments');
    const docRef = await addDoc(appointmentsRef, {
      clientName: input.clientName.trim(),
      clientPhone: input.clientPhone.trim(),
      barberId: input.staffId,
      serviceId: input.serviceId,
      extraServices: input.extraServices,
      date: Timestamp.fromDate(input.date),
      durationMinutes: input.durationMinutes,
      status: 'pending',
      notes: input.notes || '',
      createdAt: serverTimestamp(),
    });

    return docRef.id;
  } catch (error) {
    console.error('Error creating public appointment:', error);
    return null;
  }
}
