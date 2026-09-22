import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { DATA } from '../../../lib/data';
import { auth, db } from '../../../lib/firebase';
import { loadPersonalProfilePhoto } from '../../../lib/personal-profile';
import { normalizeUserRole } from '../../../lib/roles';
import type { User } from '../../../lib/types';
import JoinBusinessForm from '../JoinBusinessForm';
import PersonalProfileEditor from '../PersonalProfileEditor';

function displayName(record: User) {
  return record.name?.trim() || record.displayName?.trim() || record.email;
}

function initialsFor(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0])
      .join('')
      .toLocaleUpperCase('es-CO') || 'TU'
  );
}

function AccountAvatar({ record }: { record: User }) {
  const [photoUrl, setPhotoUrl] = useState('');
  const [failed, setFailed] = useState(false);
  const name = displayName(record);

  useEffect(() => {
    let active = true;
    let objectUrl = '';
    setPhotoUrl('');
    setFailed(false);
    if (!record.photoStoragePath) return undefined;
    void loadPersonalProfilePhoto(record.uid, record.photoStoragePath)
      .then((url) => {
        objectUrl = url;
        if (active) setPhotoUrl(url);
        else URL.revokeObjectURL(url);
      })
      .catch(() => active && setPhotoUrl(''));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [record.photoStoragePath, record.uid]);

  return (
    <span className="public-account-avatar public-business-avatar" aria-hidden="true">
      {photoUrl && !failed ? (
        <span className="public-business-avatar-image">
          <img src={photoUrl} alt="" onError={() => setFailed(true)} />
        </span>
      ) : (
        initialsFor(name)
      )}
    </span>
  );
}

export default function PublicAccountPanel({ onBack }: { onBack: () => void }) {
  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid || null);
  const [record, setRecord] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [inactiveStaff, setInactiveStaff] = useState(false);

  useEffect(() => onAuthStateChanged(auth, (user) => setUid(user?.uid || null)), []);
  useEffect(() => {
    if (!uid) {
      setRecord(null);
      setLoading(false);
      setError('');
      setInactiveStaff(false);
      return;
    }
    setLoading(true);
    setError('');
    return onSnapshot(
      doc(db, 'users', uid),
      (snapshot) => {
        if (!snapshot.exists()) {
          setRecord(null);
          setLoading(false);
          setError('No encontramos los datos de tu cuenta.');
          return;
        }
        setRecord({ uid: snapshot.id, ...(snapshot.data() as User) });
        setLoading(false);
      },
      () => {
        setRecord(null);
        setLoading(false);
        setError('No fue posible cargar tu cuenta.');
      },
    );
  }, [uid]);

  useEffect(() => {
    const role = normalizeUserRole(record?.role);
    const businessId =
      Array.isArray(record?.businessIds) && record.businessIds.length === 1
        ? record.businessIds[0]
        : undefined;
    if (role !== DATA.USER_ROLE.STAFF || !uid || typeof businessId !== 'string') {
      setInactiveStaff(false);
      return;
    }
    return onSnapshot(
      doc(db, 'barbers', businessId, 'barbers', record?.staffId || uid),
      (staff) => {
        const profile = staff.data();
        setInactiveStaff(staff.exists() && profile?.accountStatus !== 'active');
      },
      () => setInactiveStaff(false),
    );
  }, [record, uid]);

  const role = normalizeUserRole(record?.role);
  const canJoin = role === DATA.USER_ROLE.CUSTOMER;
  const phone = record?.phone?.trim() || '';
  const address = record?.address?.trim() || '';

  return (
    <>
      <section className="public-account">
        <button type="button" className="public-account-back" onClick={onBack}>
          Volver al negocio
        </button>
        {uid ? (
          loading ? (
            <div className="public-account-skeleton" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
          ) : error ? (
            <p className="error-message mt-6 text-sm" role="alert">
              {error}
            </p>
          ) : record ? (
            <>
              <div className="public-account-identity">
                <AccountAvatar record={record} />
                <div className="public-account-who">
                  <h1>{displayName(record)}</h1>
                  <p>{record.email}</p>
                </div>
                <button
                  type="button"
                  className="btn-outline public-account-edit"
                  onClick={() => setEditorOpen(true)}
                >
                  Editar
                </button>
              </div>
              {(phone || address) && (
                <dl className="public-account-facts">
                  {phone ? (
                    <div>
                      <dt>Teléfono</dt>
                      <dd>{phone}</dd>
                    </div>
                  ) : null}
                  {address ? (
                    <div>
                      <dt>Dirección</dt>
                      <dd>{address}</dd>
                    </div>
                  ) : null}
                </dl>
              )}
              {inactiveStaff && (
                <div className="public-account-join">
                  <h2>Acceso pendiente</h2>
                  <p className="public-account-copy">
                    El administrador del negocio debe activar tu acceso operativo.
                  </p>
                </div>
              )}
              {canJoin && (
                <div className="public-account-join">
                  <h2>Unirse al personal</h2>
                  <p className="public-account-copy">
                    Usa el código que te compartió el administrador. Quedarás inactivo hasta que te
                    activen.
                  </p>
                  <JoinBusinessForm className="public-account-join-form" />
                </div>
              )}
            </>
          ) : null
        ) : (
          <>
            <h1>Tu cuenta</h1>
            <p className="public-account-copy">
              Inicia sesión desde el menú para ver tu perfil o unirte al personal con un código.
            </p>
          </>
        )}
      </section>
      <PersonalProfileEditor
        open={editorOpen}
        theme="public"
        onClose={() => setEditorOpen(false)}
      />
    </>
  );
}
