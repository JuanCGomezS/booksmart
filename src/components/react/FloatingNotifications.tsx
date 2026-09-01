import type React from 'react';
import { useEffect, useRef, useState } from 'react';

export type NotificationTone = 'success' | 'error';

type Notification = {
  id: string;
  message: string;
  tone: NotificationTone;
  duration: number;
  revision: number;
  paused: boolean;
};
type NotificationDetail = Pick<Notification, 'message' | 'tone'> & { duration?: number };
type NotificationTimer = { timeout?: number; startedAt: number; remaining: number };

const notificationEvent = 'booksmart:notification';
const maximumNotifications = 3;
const notificationDuration: Record<NotificationTone, number> = {
  success: 5000,
  error: 8000,
};

function resolveDuration(tone: NotificationTone, requestedDuration?: number): number {
  if (!Number.isFinite(requestedDuration)) return notificationDuration[tone];
  return Math.min(Math.max(requestedDuration as number, 1500), 30000);
}

export function notify(message: string, tone: NotificationTone, duration?: number) {
  if (!message || typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<NotificationDetail>(notificationEvent, {
      detail: { message, tone, duration: resolveDuration(tone, duration) },
    }),
  );
}

export const notifySuccess = (message: string, duration?: number) =>
  notify(message, 'success', duration);
export const notifyError = (message: string, duration?: number) =>
  notify(message, 'error', duration);

const toneContent: Record<NotificationTone, { label: string; icon: React.ReactNode }> = {
  success: {
    label: 'Listo',
    icon: (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="m3 8.25 3.1 3.1L13 4.7" />
      </svg>
    ),
  },
  error: {
    label: 'No se pudo completar',
    icon: (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 4.25v4.5M8 11.5h.01" />
      </svg>
    ),
  },
};

export default function FloatingNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const timers = useRef(new Map<string, NotificationTimer>());
  const revisions = useRef(0);

  const clearTimer = (id: string) => {
    const timer = timers.current.get(id);
    if (timer?.timeout !== undefined) window.clearTimeout(timer.timeout);
    timers.current.delete(id);
  };

  const dismiss = (id: string) => {
    clearTimer(id);
    setNotifications((current) => current.filter((notification) => notification.id !== id));
  };

  const scheduleDismissal = (id: string, remaining: number) => {
    if (remaining <= 0) {
      dismiss(id);
      return;
    }

    const timer: NotificationTimer = { remaining, startedAt: Date.now() };
    timer.timeout = window.setTimeout(() => dismiss(id), remaining);
    timers.current.set(id, timer);
  };

  const pause = (id: string) => {
    const timer = timers.current.get(id);
    if (!timer || timer.timeout === undefined) return;

    window.clearTimeout(timer.timeout);
    timer.remaining = Math.max(0, timer.remaining - (Date.now() - timer.startedAt));
    timer.timeout = undefined;
    setNotifications((current) =>
      current.map((notification) =>
        notification.id === id ? { ...notification, paused: true } : notification,
      ),
    );
  };

  const resume = (id: string) => {
    const timer = timers.current.get(id);
    if (!timer || timer.timeout !== undefined) return;

    const { remaining } = timer;
    timers.current.delete(id);
    setNotifications((current) =>
      current.map((notification) =>
        notification.id === id ? { ...notification, paused: false } : notification,
      ),
    );
    scheduleDismissal(id, remaining);
  };

  useEffect(() => {
    const receive = (event: Event) => {
      const {
        message,
        tone,
        duration: requestedDuration,
      } = (event as CustomEvent<NotificationDetail>).detail;
      const id = `${tone}:${message}`;
      const duration = resolveDuration(tone, requestedDuration);
      const existingTimer = timers.current.get(id);
      const paused = existingTimer !== undefined && existingTimer.timeout === undefined;
      clearTimer(id);

      setNotifications((current) => {
        const revision = ++revisions.current;
        const existing = current.find((notification) => notification.id === id);
        if (existing) {
          return current.map((notification) =>
            notification.id === id ? { ...notification, duration, revision, paused } : notification,
          );
        }

        const next = [...current, { id, message, tone, duration, revision, paused: false }];
        const evicted = next.length > maximumNotifications ? next.shift() : undefined;
        if (evicted) clearTimer(evicted.id);

        return next;
      });

      if (paused) {
        timers.current.set(id, { remaining: duration, startedAt: Date.now() });
      } else {
        scheduleDismissal(id, duration);
      }
    };

    window.addEventListener(notificationEvent, receive);
    return () => {
      window.removeEventListener(notificationEvent, receive);
      timers.current.forEach((timer) => {
        if (timer.timeout !== undefined) window.clearTimeout(timer.timeout);
      });
      timers.current.clear();
    };
  }, []);

  return (
    <section className="floating-notifications" aria-label="Notificaciones" aria-live="polite">
      {notifications.map((notification) => {
        const content = toneContent[notification.tone];

        return (
          <article
            key={notification.id}
            className={`floating-notification floating-notification-${notification.tone}${notification.paused ? ' floating-notification-paused' : ''}`}
            role={notification.tone === 'error' ? 'alert' : 'status'}
            aria-atomic="true"
            onMouseEnter={() => pause(notification.id)}
            onMouseLeave={(event) => {
              if (!event.currentTarget.contains(document.activeElement)) resume(notification.id);
            }}
            onFocusCapture={() => pause(notification.id)}
            onBlurCapture={(event) => {
              if (
                !event.currentTarget.contains(event.relatedTarget as Node | null) &&
                !event.currentTarget.matches(':hover')
              )
                resume(notification.id);
            }}
          >
            <span className="floating-notification-icon">{content.icon}</span>
            <div className="floating-notification-content">
              <p className="floating-notification-label">{content.label}</p>
              <p className="floating-notification-message">{notification.message}</p>
            </div>
            <button
              type="button"
              className="floating-notification-dismiss"
              onClick={() => dismiss(notification.id)}
              aria-label="Cerrar notificación"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="m4 4 8 8M12 4l-8 8" />
              </svg>
            </button>
            <span
              key={notification.revision}
              className="floating-notification-progress"
              style={
                { '--notification-duration': `${notification.duration}ms` } as React.CSSProperties
              }
              aria-hidden="true"
            />
          </article>
        );
      })}
    </section>
  );
}
