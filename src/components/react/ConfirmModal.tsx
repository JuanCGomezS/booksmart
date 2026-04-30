import React from 'react';

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
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="surface-card w-full max-w-md rounded-2xl p-6 shadow-2xl">
        <h2 className="text-lg font-bold text-main mb-2">{title}</h2>
        <p className="text-sm text-subtle mb-6">{message}</p>

        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="btn-outline px-6 py-2 rounded-xl text-sm font-semibold"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`px-6 py-2 rounded-xl text-sm font-semibold transition-colors ${
              isDangerous
                ? 'text-white font-semibold'
                : 'btn-primary'
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
