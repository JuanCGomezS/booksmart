import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { UploadTask } from 'firebase/storage';
import { getUserRecord } from '../../lib/auth';
import { auth } from '../../lib/firebase';
import { updatePersonalProfile, uploadPersonalProfilePhoto } from '../../lib/personal-profile';
import { validateContentImage } from '../../lib/content';
import { notifyError, notifySuccess } from './FloatingNotifications';

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void | Promise<void>;
};

export default function PersonalProfileEditor({ open, onClose, onSaved }: Props) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [profileUid, setProfileUid] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const taskRef = useRef<UploadTask | null>(null);

  useEffect(
    () => () => {
      taskRef.current?.cancel();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  useEffect(() => {
    if (!open) return;
    const user = auth.currentUser;
    if (!user) return;
    setProfileUid(user.uid);
    setName('');
    setPhone('');
    setAddress('');
    dialogRef.current?.querySelector<HTMLInputElement>('#personal-profile-name')?.focus();
    void getUserRecord(user.uid)
      .then((record) => {
        if (auth.currentUser?.uid !== user.uid) return;
        setName(record?.name || record?.displayName || user.displayName || '');
        setPhone(record?.phone || '');
        setAddress(record?.address || '');
      })
      .catch(() => notifyError('No fue posible cargar tu perfil.'));
  }, [open]);

  const close = () => {
    if (saving) return;
    onClose();
  };

  const selectPhoto = (nextFile: File | null) => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl('');
    if (!nextFile) return;
    const error = validateContentImage(nextFile);
    if (error) return notifyError(error);
    setFile(nextFile);
    setPreviewUrl(URL.createObjectURL(nextFile));
  };

  const save = async () => {
    const user = auth.currentUser;
    if (!user || !profileUid || user.uid !== profileUid)
      return notifyError('Tu sesión cambió. Revisa tus datos e inténtalo de nuevo.');
    setSaving(true);
    setProgress(0);
    try {
      await updatePersonalProfile(profileUid, { name, phone, address });
      if (file)
        await uploadPersonalProfilePhoto(profileUid, file, setProgress, (task) => {
          taskRef.current = task;
        });
      setFile(null);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl('');
      await onSaved?.();
      notifySuccess('Perfil actualizado.');
      onClose();
    } catch (cause) {
      notifyError(cause instanceof Error ? cause.message : 'No fue posible actualizar tu perfil.');
    } finally {
      taskRef.current = null;
      setSaving(false);
    }
  };

  if (!open) return null;

  const themeRoot = document.querySelector<HTMLElement>('.public-business');
  const computedTheme = themeRoot ? getComputedStyle(themeRoot) : null;
  const themeStyle = computedTheme
    ? (Object.fromEntries(
        [
          '--public-bg',
          '--public-surface',
          '--public-soft',
          '--public-ink',
          '--surface',
          '--text-primary',
          '--text-secondary',
          '--border',
          '--primary',
          '--secondary',
          '--on-secondary',
          '--accent',
          '--public-border',
          '--public-action',
          '--public-on-action',
          '--public-accent',
          '--public-muted',
          '--public-curve',
          '--shadow',
        ].map((name) => [name, computedTheme.getPropertyValue(name)]),
      ) as CSSProperties)
    : undefined;

  return createPortal(
    <div
      className="personal-profile-modal fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{
        ...themeStyle,
        background: 'color-mix(in srgb, var(--public-bg) 72%, transparent)',
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        className="personal-profile-modal-panel w-full max-w-lg p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="personal-profile-title"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="personal-profile-title" className="text-xl font-bold text-main">
              Editar perfil
            </h2>
            <p className="mt-1 text-sm text-subtle">
              Estos datos se usarán para agilizar tus agendamientos.
            </p>
          </div>
          <button
            type="button"
            className="personal-profile-modal-close"
            aria-label="Cerrar perfil"
            onClick={close}
          >
            ×
          </button>
        </div>
        <form
          className="mt-6 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="field-label block" htmlFor="personal-profile-name">
            Nombre
            <input
              id="personal-profile-name"
              className="personal-profile-modal-input mt-1"
              value={name}
              maxLength={120}
              required
              disabled={saving}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="field-label block" htmlFor="personal-profile-phone">
            Celular <span className="font-normal text-subtle">(opcional)</span>
            <input
              id="personal-profile-phone"
              className="personal-profile-modal-input mt-1"
              value={phone}
              maxLength={40}
              inputMode="tel"
              autoComplete="tel"
              disabled={saving}
              onChange={(event) => setPhone(event.target.value)}
            />
          </label>
          <label className="field-label block" htmlFor="personal-profile-address">
            Dirección <span className="font-normal text-subtle">(opcional)</span>
            <input
              id="personal-profile-address"
              className="personal-profile-modal-input mt-1"
              value={address}
              maxLength={240}
              autoComplete="street-address"
              disabled={saving}
              onChange={(event) => setAddress(event.target.value)}
            />
          </label>
          <div>
            <span className="field-label block">
              Foto <span className="font-normal text-subtle">(opcional)</span>
            </span>
            <label className="personal-profile-modal-upload mt-2 inline-flex cursor-pointer text-sm font-semibold">
              Seleccionar foto
              <input
                className="sr-only"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={saving}
                onChange={(event) => selectPhoto(event.target.files?.[0] || null)}
              />
            </label>
            {previewUrl && (
              <img
                className="mt-3 h-20 w-20 rounded object-cover"
                src={previewUrl}
                alt="Vista previa de tu foto de perfil"
              />
            )}
            {progress > 0 && <p className="mt-2 text-sm text-subtle">Subiendo foto: {progress}%</p>}
          </div>
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <button
              type="button"
              className="personal-profile-modal-cancel"
              disabled={saving}
              onClick={close}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="personal-profile-modal-save disabled:opacity-50"
              disabled={saving || !name.trim()}
            >
              {saving ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
