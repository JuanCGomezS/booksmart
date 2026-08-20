import React, { useEffect, useRef, useState } from 'react';
import type { UploadTask } from 'firebase/storage';
import { doc, onSnapshot } from 'firebase/firestore';
import type { BarberStaff } from '../../../lib/types';
import {
  createOwnStoreadminProfessionalProfile,
  replaceOwnProfessionalPhoto,
  updateOwnProfessionalName,
} from '../../../lib/professional-profile';
import { validateContentImage } from '../../../lib/content';
import { notifyError, notifySuccess } from '../FloatingNotifications';
import { db } from '../../../lib/firebase';

type Props = {
  businessId: string;
  uid: string;
  role: 'staff' | 'storeadmin';
  profile?: BarberStaff | null;
  initialName?: string;
  onChange?: () => void | Promise<void>;
};

export default function ProfessionalProfileForm({
  businessId,
  uid,
  role,
  profile,
  initialName = '',
  onChange,
}: Props) {
  const [loadedProfile, setLoadedProfile] = useState<BarberStaff | null | undefined>(profile);
  const effectiveProfile = profile === undefined ? loadedProfile : profile;
  const [name, setName] = useState(effectiveProfile?.name || initialName);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const taskRef = useRef<UploadTask | null>(null);

  useEffect(() => {
    if (profile !== undefined) return;
    return onSnapshot(
      doc(db, 'barbers', businessId, 'barbers', uid),
      (snapshot) => {
        setLoadedProfile(
          snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as BarberStaff) : null,
        );
      },
      () => notifyError('No fue posible cargar tu perfil profesional.'),
    );
  }, [businessId, profile, uid]);
  useEffect(() => {
    setName(effectiveProfile?.name || initialName);
  }, [effectiveProfile?.name, initialName]);
  useEffect(
    () => () => {
      taskRef.current?.cancel();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );
  const selectPhoto = (nextFile: File | null) => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl('');
    setFile(null);
    if (!nextFile) return;
    const error = validateContentImage(nextFile);
    if (error) return notifyError(error);
    setFile(nextFile);
    setPreviewUrl(URL.createObjectURL(nextFile));
  };
  const clearSelectedPhoto = () => {
    setFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl('');
  };
  const pendingReplacementCleanupPaths = Array.isArray(effectiveProfile?.pendingImageCleanupPaths)
    ? effectiveProfile.pendingImageCleanupPaths.filter(
        (path): path is string => typeof path === 'string',
      )
    : [];
  const save = async () => {
    if (saving) return;
    setSaving(true);
    setProgress(0);
    try {
      if (!effectiveProfile) {
        if (role !== 'storeadmin') throw new Error('Tu perfil profesional aún no está disponible.');
        await createOwnStoreadminProfessionalProfile(businessId, uid, name);
      } else if (name.trim() !== effectiveProfile.name) {
        await updateOwnProfessionalName(businessId, uid, name);
      }
      if (file)
        await replaceOwnProfessionalPhoto(businessId, uid, file, setProgress, (task) => {
          taskRef.current = task;
        });
      clearSelectedPhoto();
      await onChange?.();
      notifySuccess('Perfil profesional guardado.');
    } catch (error) {
      notifyError(
        error instanceof Error ? error.message : 'No fue posible guardar tu perfil profesional.',
      );
    } finally {
      taskRef.current = null;
      setSaving(false);
    }
  };
  const hasProfile = Boolean(effectiveProfile);
  const displayedPhoto = previewUrl || effectiveProfile?.photoUrl;
  return (
    <section
      className="surface-soft max-w-2xl rounded-xl p-4"
      aria-labelledby="professional-profile-title"
    >
      <div>
        <h2 id="professional-profile-title" className="text-lg font-bold text-main">
          Mi perfil profesional
        </h2>
        <p className="mt-1 text-sm text-subtle">
          {hasProfile
            ? 'Actualiza el nombre y la foto que verán los clientes.'
            : 'Crea tu perfil opcional para atender clientes en este negocio.'}
        </p>
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <label className="field-label">
          Nombre profesional
          <input
            className="field-input mt-1"
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            disabled={saving}
          />
        </label>
        <div>
          <p className="field-label">Estado</p>
          <output
            className="mt-1 block rounded border px-3 py-2 text-sm text-subtle"
            aria-label="Estado del perfil profesional"
          >
            {effectiveProfile
              ? effectiveProfile.active
                ? 'Activo'
                : 'Inactivo'
              : 'Se definirá al crear el perfil'}
          </output>
          <p className="mt-1 text-xs text-subtle">
            Solo la administración puede cambiar este estado.
          </p>
        </div>
      </div>
      <div className="mt-4">
        <label className="btn-outline inline-flex cursor-pointer rounded-lg px-3 py-2 text-sm font-semibold">
          Seleccionar foto
          <input
            className="sr-only"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={saving}
            onChange={(event) => selectPhoto(event.target.files?.[0] || null)}
          />
        </label>
        {displayedPhoto && (
          <img
            className="mt-3 h-24 w-24 rounded-lg object-cover"
            src={displayedPhoto}
            alt="Vista previa de tu foto profesional"
          />
        )}
        {progress > 0 && <p className="mt-2 text-sm text-subtle">Subiendo foto: {progress}%</p>}
      </div>
      {pendingReplacementCleanupPaths.length > 0 && (
        <p className="mt-4 text-sm text-subtle" role="status">
          {pendingReplacementCleanupPaths.length === 1
            ? 'Una foto anterior se conservará'
            : 'Las fotos anteriores se conservarán'}{' '}
          hasta que la administración retire y desvincule este perfil.
        </p>
      )}
      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
          disabled={saving || !name.trim()}
          onClick={() => void save()}
        >
          {saving ? 'Guardando…' : hasProfile ? 'Guardar perfil' : 'Crear mi perfil profesional'}
        </button>
        {saving && taskRef.current && (
          <button
            type="button"
            className="btn-outline rounded-lg px-4 py-2 text-sm font-semibold"
            onClick={() => taskRef.current?.cancel()}
          >
            Cancelar carga
          </button>
        )}
      </div>
    </section>
  );
}
