import React, { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { getFirestoreWriteErrorMessage, updateBarberManagedRecord } from '../../../lib/barbers';
import { normalizeWeeklySchedule } from '../../../lib/booking';
import type { WeeklySchedule } from '../../../lib/types';
import { notifyError, notifySuccess } from '../FloatingNotifications';

const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const emptySchedule = (): WeeklySchedule => normalizeWeeklySchedule({});
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Staff-only editor. The rule also limits this path to schedule + updatedAt. */
export default function OwnSchedulePanel({
  businessId,
  staffId,
}: {
  businessId: string;
  staffId: string;
}) {
  const [schedule, setSchedule] = useState<WeeklySchedule>(emptySchedule);
  const [loadError, setLoadError] = useState('');
  const [validationMessage, setValidationMessage] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    void getDoc(doc(db, 'barbers', businessId, 'barbers', staffId))
      .then((snapshot) => {
        setSchedule(
          normalizeWeeklySchedule(snapshot.exists() ? snapshot.data().schedule : undefined),
        );
      })
      .catch(() => setLoadError('No fue posible cargar tu horario.'));
  }, [businessId, staffId]);
  const save = async () => {
    setValidationMessage('');
    if (
      Object.values(schedule).some(
        (day) =>
          day.enabled && (!TIME.test(day.start) || !TIME.test(day.end) || day.start >= day.end),
      )
    ) {
      setValidationMessage(
        'En los días activos, la hora inicial debe ser anterior a la hora final.',
      );
      return;
    }
    const normalized = normalizeWeeklySchedule(schedule);
    setSaving(true);
    try {
      await updateBarberManagedRecord(businessId, 'barbers', staffId, { schedule: normalized });
      setSchedule(normalized);
      notifySuccess('Horario guardado.');
    } catch (error) {
      notifyError(getFirestoreWriteErrorMessage(error, 'No se pudo guardar el horario.'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="surface-card max-w-3xl rounded-2xl p-6">
      <h2 className="text-xl font-bold text-main">Mi horario</h2>
      <p className="mt-1 text-sm text-subtle">
        Solo puede modificar su propio horario. Los descansos se mantienen desde la configuración
        operativa.
      </p>
      {loadError && (
        <p className="error-message mt-4 text-sm" role="alert">
          {loadError}
        </p>
      )}
      {validationMessage && (
        <p className="error-message mt-4 text-sm" role="alert">
          {validationMessage}
        </p>
      )}
      <div className="mt-5 space-y-2">
        {DAYS.map((day, index) => {
          const current = schedule[index] || emptySchedule()[index];
          return (
            <div
              key={day}
              className="surface-soft grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-lg p-3"
            >
              <label className="flex items-center gap-2 text-sm text-main">
                <input
                  type="checkbox"
                  checked={current.enabled}
                  onChange={(event) =>
                    setSchedule({
                      ...schedule,
                      [index]: { ...current, enabled: event.target.checked },
                    })
                  }
                />
                {day}
              </label>
              <input
                className="field-input"
                type="time"
                disabled={!current.enabled}
                value={current.start}
                onChange={(event) =>
                  setSchedule({ ...schedule, [index]: { ...current, start: event.target.value } })
                }
              />
              <input
                className="field-input"
                type="time"
                disabled={!current.enabled}
                value={current.end}
                onChange={(event) =>
                  setSchedule({ ...schedule, [index]: { ...current, end: event.target.value } })
                }
              />
            </div>
          );
        })}
      </div>
      <button
        type="button"
        disabled={saving}
        onClick={() => void save()}
        className="btn-primary mt-5 rounded-lg px-4 py-2 disabled:opacity-50"
      >
        {saving ? 'Guardando...' : 'Guardar mi horario'}
      </button>
    </section>
  );
}
