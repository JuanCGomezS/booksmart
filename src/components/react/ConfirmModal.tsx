import React, { useEffect, useRef } from 'react';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDangerous?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  isOpen,
  title,
  message,
  confirmText = 'Aceptar',
  cancelText = 'Cancelar',
  isDangerous = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelButtonRef.current?.focus();
    return () => trigger?.focus();
  }, [isOpen]);

  if (!isOpen) return null;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      onCancel();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={dialogRef}
        role={isDangerous ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        aria-describedby="confirm-modal-message"
        className="surface-card w-full max-w-md rounded-2xl p-6 shadow-2xl"
      >
        <h2 id="confirm-modal-title" className="text-lg font-bold text-main mb-2">
          {title}
        </h2>
        <p id="confirm-modal-message" className="text-sm text-subtle mb-6">
          {message}
        </p>

        <div className="flex gap-3 justify-end">
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onCancel}
            className="btn-outline px-6 py-2 rounded-xl text-sm font-semibold"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-6 py-2 rounded-xl text-sm font-semibold transition-colors ${
              isDangerous ? 'text-white font-semibold' : 'btn-primary'
            }`}
            style={
              isDangerous
                ? { background: 'color-mix(in srgb, #ef4444 72%, var(--accent))', color: 'white' }
                : undefined
            }
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
