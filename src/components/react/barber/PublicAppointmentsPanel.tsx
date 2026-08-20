import React, { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, getDocs, query, updateDoc, doc, where } from 'firebase/firestore';
import { auth, db } from '../../../lib/firebase';

type Item = { id: string; bookingDate?: string; startTime?: string; serviceName?: string; status?: string };
const labels: Record<string, string> = { pending: 'Pendiente', confirmed: 'Confirmada', cancelled: 'Cancelada', done: 'Realizada', no_show: 'No asistió' };

export default function PublicAppointmentsPanel({ businessId }: { businessId: string }) {
  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid || null);
  const [items, setItems] = useState<Item[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  useEffect(() => onAuthStateChanged(auth, (user) => setUid(user?.uid || null)), []);
  useEffect(() => { if (!uid) { setLoading(false); return; } let active = true; void getDocs(query(collection(db, 'barbers', businessId, 'appointments'), where('customerUid', '==', uid))).then((snapshot) => { if (active) setItems(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as Item)).sort((a, b) => `${b.bookingDate || ''}${b.startTime || ''}`.localeCompare(`${a.bookingDate || ''}${a.startTime || ''}`))); }).catch(() => active && setError('No fue posible cargar tus agendamientos.')).finally(() => active && setLoading(false)); return () => { active = false; }; }, [businessId, uid]);
  const cancel = async (id: string) => { try { await updateDoc(doc(db, 'barbers', businessId, 'appointments', id), { status: 'cancelled', updatedAt: new Date() }); setItems((current) => current.map((item) => item.id === id ? { ...item, status: 'cancelled' } : item)); } catch { setError('No fue posible cancelar el agendamiento.'); } };
  if (!uid) return <div className="surface-card rounded-2xl p-6"><h2 className="text-xl font-bold text-main">Mis agendamientos</h2><p className="mt-2 text-sm text-subtle">Inicia sesión desde el menú para consultar y cancelar tus agendamientos.</p></div>;
  return <section className="surface-card rounded-2xl p-6"><h2 className="text-xl font-bold text-main">Mis agendamientos</h2>{loading ? <p className="mt-4 text-sm text-subtle">Cargando…</p> : error ? <p className="error-message mt-4 text-sm" role="alert">{error}</p> : items.length === 0 ? <p className="mt-4 text-sm text-subtle">No tienes agendamientos en este negocio.</p> : <ul className="mt-4 space-y-3">{items.map((item) => <li key={item.id} className="surface-soft flex flex-wrap items-center justify-between gap-3 rounded-xl p-4"><div><p className="font-semibold text-main">{item.serviceName || 'Servicio'}</p><p className="text-sm text-subtle">{item.bookingDate} · {item.startTime} · {labels[item.status || ''] || item.status}</p></div>{['pending', 'confirmed'].includes(item.status || '') && <button type="button" className="btn-outline rounded px-3 py-2 text-sm" onClick={() => void cancel(item.id)}>Cancelar</button>}</li>)}</ul>}</section>;
}
