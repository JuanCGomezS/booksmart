import React, { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { updateBarberManagedRecord } from '../../../lib/barbers';
import type { WeeklySchedule } from '../../../lib/types';

const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const emptySchedule = (): WeeklySchedule => Object.fromEntries(DAYS.map((_, day) => [day, { enabled: false, start: '09:00', end: '18:00', breaks: [] }])) as WeeklySchedule;

/** Staff-only editor. The rule also limits this path to schedule + updatedAt. */
export default function OwnSchedulePanel({ businessId, staffId }: { businessId: string; staffId: string }) {
  const [schedule, setSchedule] = useState<WeeklySchedule>(emptySchedule); const [message, setMessage] = useState(''); const [saving, setSaving] = useState(false);
  useEffect(() => { void getDoc(doc(db, 'barbers', businessId, 'barbers', staffId)).then((snapshot) => { if (snapshot.exists() && snapshot.data().schedule) setSchedule(snapshot.data().schedule as WeeklySchedule); }).catch(() => setMessage('No fue posible cargar tu horario.')); }, [businessId, staffId]);
  const save = async () => { setSaving(true); setMessage(''); try { const ok = await updateBarberManagedRecord(businessId, 'barbers', staffId, { schedule }); setMessage(ok ? 'Horario guardado.' : 'No se pudo guardar el horario.'); } finally { setSaving(false); } };
  return <section className="surface-card max-w-3xl rounded-2xl p-6"><h2 className="text-xl font-bold text-main">Mi horario</h2><p className="mt-1 text-sm text-subtle">Sólo podés modificar tu propio horario. Los descansos se mantienen desde la configuración operativa.</p><div className="mt-5 space-y-2">{DAYS.map((day, index) => { const current = schedule[index] || { enabled: false, start: '09:00', end: '18:00', breaks: [] }; return <div key={day} className="surface-soft grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-lg p-3"><label className="flex items-center gap-2 text-sm text-main"><input type="checkbox" checked={current.enabled} onChange={(event) => setSchedule({ ...schedule, [index]: { ...current, enabled: event.target.checked } })} />{day}</label><input className="field-input" type="time" disabled={!current.enabled} value={current.start} onChange={(event) => setSchedule({ ...schedule, [index]: { ...current, start: event.target.value } })} /><input className="field-input" type="time" disabled={!current.enabled} value={current.end} onChange={(event) => setSchedule({ ...schedule, [index]: { ...current, end: event.target.value } })} /></div>; })}</div>{message && <p className="mt-4 text-sm text-subtle">{message}</p>}<button type="button" disabled={saving} onClick={() => void save()} className="btn-primary mt-5 rounded-lg px-4 py-2 disabled:opacity-50">{saving ? 'Guardando...' : 'Guardar mi horario'}</button></section>;
}
