import { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { cancelCustomerAppointment } from '../../../lib/booking-transaction';
import { auth, db } from '../../../lib/firebase';
import { CANCELLATION_NOTE_MAX_LENGTH } from '../../../lib/types';

type Item = {
  id: string;
  bookingDate?: string;
  startTime?: string;
  serviceName?: string;
  status?: string;
  cancellationNote?: string;
};
const labels: Record<string, string> = {
  pending: 'Pendiente',
  confirmed: 'Confirmada',
  cancelled: 'Cancelada',
  done: 'Realizada',
  no_show: 'No asistió',
};
const cancellationDeadlineMs = 60 * 60 * 1_000;
const pageSize = 10;

function canCancel(item: Item, now: number) {
  if (!['pending', 'confirmed'].includes(item.status || '')) return false;
  const date = item.bookingDate?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const time = item.startTime?.match(/^(\d{2}):(\d{2})$/);
  if (!date || !time) return false;
  const appointmentAt = new Date(
    Number(date[1]),
    Number(date[2]) - 1,
    Number(date[3]),
    Number(time[1]),
    Number(time[2]),
  ).getTime();
  return appointmentAt - now > cancellationDeadlineMs;
}

export default function PublicAppointmentsPanel({ businessId }: { businessId: string }) {
  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid || null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancellationNote, setCancellationNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [page, setPage] = useState(0);
  useEffect(() => onAuthStateChanged(auth, (user) => setUid(user?.uid || null)), []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!uid) {
      setLoading(false);
      return;
    }
    let active = true;
    void getDocs(
      query(collection(db, 'barbers', businessId, 'appointments'), where('customerUid', '==', uid)),
    )
      .then((snapshot) => {
        if (active)
          setItems(
            snapshot.docs
              .map((entry) => ({ id: entry.id, ...entry.data() }) as Item)
              .sort((a, b) =>
                `${b.bookingDate || ''}${b.startTime || ''}`.localeCompare(
                  `${a.bookingDate || ''}${a.startTime || ''}`,
                ),
              ),
          );
      })
      .catch(() => active && setError('No fue posible cargar tus agendamientos.'))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [businessId, uid]);
  useEffect(() => {
    setPage(0);
    setCancellingId(null);
  }, [businessId, uid]);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = useMemo(
    () => items.slice(currentPage * pageSize, currentPage * pageSize + pageSize),
    [currentPage, items],
  );
  useEffect(() => {
    if (page !== currentPage) setPage(currentPage);
  }, [currentPage, page]);
  const cancel = async (id: string) => {
    const note = cancellationNote.trim();
    if (!note) {
      setError('Escribe una nota de cancelación.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await cancelCustomerAppointment(businessId, id, note);
      setItems((current) =>
        current.map((item) =>
          item.id === id ? { ...item, status: 'cancelled', cancellationNote: note } : item,
        ),
      );
      setCancellingId(null);
      setCancellationNote('');
    } catch {
      setError('No fue posible cancelar el agendamiento.');
    } finally {
      setSubmitting(false);
    }
  };
  if (!uid)
    return (
      <section className="public-appointments">
        <h2>Mis agendamientos</h2>
        <p className="public-appointments-copy">
          Inicia sesión desde el menú para consultar y cancelar tus agendamientos.
        </p>
      </section>
    );
  const from = items.length === 0 ? 0 : currentPage * pageSize + 1;
  const to = Math.min(items.length, currentPage * pageSize + visible.length);
  return (
    <section className="public-appointments">
      <h2>Mis agendamientos</h2>
      {loading ? (
        <p className="public-appointments-copy">Cargando…</p>
      ) : error ? (
        <p className="error-message mt-4 text-sm" role="alert">
          {error}
        </p>
      ) : items.length === 0 ? (
        <p className="public-appointments-copy">No tienes agendamientos en este negocio.</p>
      ) : (
        <>
          <ul className="public-appointments-list">
            {visible.map((item) => (
              <li key={item.id} className="public-appointments-item">
                <div className="public-appointments-row">
                  <div>
                    <p className="public-appointments-service">{item.serviceName || 'Servicio'}</p>
                    <p className="public-appointments-meta">
                      {item.bookingDate} · {item.startTime}
                    </p>
                    <p className={`public-appointments-status status-${item.status || ''}`}>
                      {labels[item.status || ''] || item.status}
                    </p>
                    {item.status === 'cancelled' && item.cancellationNote?.trim() ? (
                      <p className="public-appointments-note">{item.cancellationNote.trim()}</p>
                    ) : null}
                  </div>
                  {canCancel(item, now) && cancellingId !== item.id && (
                    <button
                      type="button"
                      className="btn-outline public-appointments-cancel"
                      onClick={() => {
                        setError('');
                        setCancellingId(item.id);
                        setCancellationNote('');
                      }}
                    >
                      Cancelar
                    </button>
                  )}
                </div>
                {cancellingId === item.id && (
                  <div className="public-appointments-form">
                    <label htmlFor={`cancel-${item.id}`}>
                      Motivo de cancelación
                      <textarea
                        id={`cancel-${item.id}`}
                        className="field-input mt-2 w-full"
                        rows={3}
                        maxLength={CANCELLATION_NOTE_MAX_LENGTH}
                        value={cancellationNote}
                        onChange={(event) => setCancellationNote(event.target.value)}
                        disabled={submitting}
                        required
                      />
                    </label>
                    <div className="public-appointments-form-actions">
                      <button
                        type="button"
                        className="btn-primary rounded px-3 py-2 text-sm"
                        disabled={submitting}
                        onClick={() => void cancel(item.id)}
                      >
                        {submitting ? 'Cancelando…' : 'Confirmar cancelación'}
                      </button>
                      <button
                        type="button"
                        className="btn-outline rounded px-3 py-2 text-sm"
                        disabled={submitting}
                        onClick={() => {
                          setCancellingId(null);
                          setCancellationNote('');
                        }}
                      >
                        No cancelar
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div className="public-appointments-pager">
            <p>
              {from}–{to} de {items.length}
            </p>
            {pageCount > 1 && (
              <div>
                <button
                  type="button"
                  className="btn-outline public-appointments-page"
                  disabled={currentPage === 0}
                  onClick={() => {
                    setCancellingId(null);
                    setPage((value) => Math.max(0, value - 1));
                  }}
                >
                  Anterior
                </button>
                <button
                  type="button"
                  className="btn-outline public-appointments-page"
                  disabled={currentPage >= pageCount - 1}
                  onClick={() => {
                    setCancellingId(null);
                    setPage((value) => Math.min(pageCount - 1, value + 1));
                  }}
                >
                  Siguiente
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
