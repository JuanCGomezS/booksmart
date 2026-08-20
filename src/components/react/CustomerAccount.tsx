import React, { useEffect, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { getCurrentUser, signOut } from '../../lib/auth';
import { DATA } from '../../lib/data';
import { db } from '../../lib/firebase';
import { normalizeUserRole } from '../../lib/roles';
import { joinBusinessWithCode } from '../../lib/staff-enrollment';
import { notifyError } from './FloatingNotifications';
import ProfessionalProfileForm from './admin/ProfessionalProfileForm';
import type { BarberStaff } from '../../lib/types';

export default function CustomerAccount() {
  const baseUrl = import.meta.env.BASE_URL;
  const [state, setState] = useState<'loading' | 'overview' | 'join' | 'inactive' | 'error'>(
    'loading',
  );
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [staffBinding, setStaffBinding] = useState<{ businessId: string; staffId: string } | null>(
    null,
  );
  const [staffProfile, setStaffProfile] = useState<BarberStaff | null>(null);
  const [verificationAttempt, setVerificationAttempt] = useState(0);
  const overviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const joinHeadingRef = useRef<HTMLHeadingElement>(null);
  const inactiveHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (state === 'overview') overviewHeadingRef.current?.focus();
    if (state === 'join') joinHeadingRef.current?.focus();
    if (state === 'inactive') inactiveHeadingRef.current?.focus();
  }, [state]);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    const failVerification = () => {
      if (cancelled) return;
      setStaffBinding(null);
      setState('error');
    };

    void getCurrentUser()
      .then((current) => {
        if (cancelled) return;
        const user = current?.userRecord;
        if (!current) return window.location.replace(`${baseUrl}login`);
        if (!user || !normalizeUserRole(user.role)) return failVerification();

        unsubscribe = onSnapshot(
          doc(db, 'users', user.uid),
          (snapshot) => {
            if (cancelled) return;
            const next = snapshot.data();
            const role = normalizeUserRole(next?.role);
            if (role === DATA.USER_ROLE.CUSTOMER) {
              setStaffBinding(null);
              setState('overview');
              return;
            }
            const businessId =
              Array.isArray(next?.businessIds) && next.businessIds.length === 1
                ? next.businessIds[0]
                : undefined;
            if (
              role !== DATA.USER_ROLE.STAFF ||
              typeof businessId !== 'string' ||
              typeof next?.staffId !== 'string'
            ) {
              window.location.replace(`${baseUrl}admin`);
              return;
            }
            setStaffBinding({ businessId, staffId: next.staffId });
          },
          failVerification,
        );
      })
      .catch(failVerification);

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [baseUrl, verificationAttempt]);

  useEffect(() => {
    if (!staffBinding) return;
    return onSnapshot(
      doc(db, 'barbers', staffBinding.businessId, 'barbers', staffBinding.staffId),
      (staff) => {
        if (!staff.exists()) {
          setStaffBinding(null);
          setState('error');
          return;
        }
        const profile = { id: staff.id, ...staff.data() } as BarberStaff;
        setStaffProfile(profile);
        if (profile.accountStatus === 'active') return window.location.replace(`${baseUrl}admin`);
        setState('inactive');
      },
      () => {
        setStaffBinding(null);
        setState('error');
      },
    );
  }, [baseUrl, staffBinding]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      await joinBusinessWithCode(code);
      setCode('');
      setState('inactive');
    } catch (cause) {
      notifyError(
        cause instanceof Error
          ? cause.message
          : 'No fue posible unirte al negocio. Revisa el código e inténtalo nuevamente.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const closeSession = async () => {
    await signOut();
    sessionStorage.removeItem('userRole');
    window.location.replace(`${baseUrl}login`);
  };

  if (state === 'loading')
    return (
      <main className="section-shell flex min-h-screen items-center justify-center">
        <p className="text-subtle" role="status">
          Verificando tu cuenta…
        </p>
      </main>
    );
  if (state === 'inactive' && staffBinding && staffProfile)
    return (
      <main className="section-shell min-h-screen">
        <div className="mx-auto flex max-w-xl px-4 py-16">
          <div className="w-full space-y-5">
            <section className="surface-card rounded-lg p-6 sm:p-8">
              <p className="press-label text-[var(--secondary)]">Mi cuenta</p>
              <h1
                ref={inactiveHeadingRef}
                tabIndex={-1}
                className="mt-3 text-3xl font-bold text-main"
              >
                Acceso pendiente
              </h1>
              <p className="mt-2 max-w-prose text-sm text-subtle">
                Tu administrador debe activar el acceso operativo. Mientras tanto puedes completar
                tu perfil profesional.
              </p>
            </section>
            <ProfessionalProfileForm
              businessId={staffBinding.businessId}
              uid={staffBinding.staffId}
              role="staff"
              profile={staffProfile}
              onChange={() => undefined}
            />
            <button
              type="button"
              className="btn-outline w-full rounded-lg px-4 py-3 font-semibold"
              onClick={() => void closeSession()}
            >
              Cerrar sesión
            </button>
          </div>
        </div>
      </main>
    );

  return (
    <main className="section-shell min-h-screen">
      <div className="mx-auto flex max-w-xl px-4 py-16">
        <section className="surface-card w-full rounded-lg p-6 sm:p-8">
          <p className="press-label text-[var(--secondary)]">Mi cuenta</p>
          {state === 'overview' ? (
            <>
              <h1
                ref={overviewHeadingRef}
                tabIndex={-1}
                className="mt-3 text-3xl font-bold text-main"
              >
                Tu cuenta
              </h1>
              <p className="mt-2 max-w-prose text-sm text-subtle">
                Gestiona tu acceso o solicita unirte al personal de un negocio.
              </p>
              <div className="mt-7 grid gap-3">
                <button
                  type="button"
                  className="surface-soft account-menu-option rounded-lg p-4 text-left"
                  onClick={() => setState('join')}
                >
                  <span className="block font-semibold text-main">Unirse a un negocio</span>
                  <span className="mt-1 block text-sm text-subtle">
                    Ingresa el código que te proporcionó su administrador.
                  </span>
                </button>
                <button
                  type="button"
                  className="btn-outline w-full rounded-lg px-4 py-3 font-semibold"
                  onClick={() => void closeSession()}
                >
                  Cerrar sesión
                </button>
              </div>
            </>
          ) : state === 'join' ? (
            <>
              <button
                type="button"
                className="accent-link text-sm font-semibold text-main"
                onClick={() => setState('overview')}
              >
                ← Volver a mi cuenta
              </button>
              <h1 ref={joinHeadingRef} tabIndex={-1} className="mt-3 text-3xl font-bold text-main">
                Unirse a un negocio
              </h1>
              <p className="mt-2 max-w-prose text-sm text-subtle">
                Ingresa el código del negocio que te proporcionó el administrador. Te unirás como
                personal inactivo hasta que active tu acceso.
              </p>
              <form className="mt-7 space-y-4" onSubmit={submit}>
                <label className="block text-sm font-semibold text-main" htmlFor="business-code">
                  Código del negocio
                  <input
                    id="business-code"
                    autoComplete="off"
                    spellCheck={false}
                    value={code}
                    onChange={(event) => setCode(event.target.value.toUpperCase())}
                    placeholder="ABCDE-FGHIJ-KLMNO-PQRST-UVWXY-Z"
                    className="field-input mt-2 w-full uppercase"
                    disabled={submitting}
                    required
                  />
                </label>
                <button
                  type="submit"
                  className="btn-primary w-full rounded-lg px-4 py-3 font-semibold disabled:opacity-50"
                  disabled={submitting}
                >
                  {submitting ? 'Uniéndote al negocio…' : 'Unirme al negocio'}
                </button>
              </form>
            </>
          ) : state === 'error' ? (
            <>
              <h1 className="mt-3 text-3xl font-bold text-main">No pudimos verificar tu cuenta</h1>
              <p className="mt-2 max-w-prose text-sm text-subtle" role="alert">
                Tu sesión sigue abierta, pero no pudimos comprobar tu acceso. Reintenta antes de
                cambiar tu cuenta.
              </p>
              <div className="mt-7 grid gap-3">
                <button
                  type="button"
                  className="btn-primary w-full rounded-lg px-4 py-3 font-semibold"
                  onClick={() => {
                    setStaffBinding(null);
                    setState('loading');
                    setVerificationAttempt((value) => value + 1);
                  }}
                >
                  Reintentar
                </button>
                <button
                  type="button"
                  className="btn-outline w-full rounded-lg px-4 py-3 font-semibold"
                  onClick={() => void closeSession()}
                >
                  Cerrar sesión
                </button>
              </div>
            </>
          ) : (
            <>
              <h1
                ref={inactiveHeadingRef}
                tabIndex={-1}
                className="mt-3 text-3xl font-bold text-main"
              >
                Tu acceso está inactivo
              </h1>
              <p className="mt-2 max-w-prose text-sm text-subtle">
                Ya perteneces al personal de este negocio. Comunícate con su administrador para
                activar tu acceso.
              </p>
              <button
                type="button"
                className="btn-outline mt-7 w-full rounded-lg px-4 py-3 font-semibold"
                onClick={() => void closeSession()}
              >
                Cerrar sesión
              </button>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
