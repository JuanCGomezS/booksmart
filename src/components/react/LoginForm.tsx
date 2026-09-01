import type { FormEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import {
  completeGoogleClientRegistration,
  getUserRecord,
  LEGAL_CONSENT_VERSION,
  requestPasswordReset,
  signIn,
  signInWithGoogle,
  signOut,
  signUpClient,
} from '../../lib/auth';
import { notifyError } from './FloatingNotifications';
import { getSafeReturnTo } from '../../lib/return-to';
import { normalizeUserRole } from '../../lib/roles';

type AuthMode = 'welcome' | 'login' | 'register' | 'reset';

interface LoginFormProps {
  initialMode?: 'login' | 'register';
  accountRedirect?: string;
  onSuccess?: (userId: string) => void;
  onError?: (message: string) => void;
}

function authenticationErrorMessage(error: unknown, mode: AuthMode): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: string }).code
      : undefined;

  switch (code) {
    case 'auth/invalid-email':
      return 'Escribe un correo electrónico válido.';
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return 'El correo o la contraseña no coinciden. Verifícalos o crea una cuenta.';
    case 'auth/user-disabled':
      return 'Esta cuenta está deshabilitada. Comunícate con el administrador para recuperar el acceso.';
    case 'auth/email-already-in-use':
      return 'Ya existe una cuenta con este correo. Inicia sesión para continuar.';
    case 'auth/account-exists-with-different-credential':
      return 'Este correo ya usa contraseña. Inicia sesión con tu contraseña.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Se canceló el inicio de sesión con Google.';
    case 'auth/weak-password':
      return 'La contraseña debe tener al menos seis caracteres.';
    case 'auth/network-request-failed':
      return 'No fue posible conectar con el servicio. Verifica tu conexión e inténtalo nuevamente.';
    case 'auth/too-many-requests':
      return 'Se bloquearon temporalmente los intentos de acceso. Espera unos minutos antes de intentarlo nuevamente.';
    case 'auth/operation-not-allowed':
      return 'Esta operación no está disponible en este momento. Inténtalo más tarde.';
    case 'registration/profile-creation-reverted':
      return 'No pudimos configurar tu perfil y cancelamos la creación de la cuenta. Verifica tu conexión e inténtalo nuevamente.';
    case 'registration/profile-creation-recovery-failed':
      return 'No pudimos configurar tu perfil ni revertir por completo la cuenta. No intentes registrarte otra vez: inicia sesión o contacta al soporte para revisar el acceso.';
    default:
      if (mode === 'reset') return 'No fue posible enviar el enlace. Inténtalo nuevamente.';
      return mode === 'register'
        ? 'No fue posible crear la cuenta. Verifica tus datos e inténtalo nuevamente.'
        : 'No fue posible iniciar sesión. Verifica tus datos e inténtalo nuevamente.';
  }
}

export default function LoginForm({
  initialMode = 'login',
  accountRedirect,
  onSuccess,
  onError,
}: LoginFormProps) {
  const baseUrl = import.meta.env.BASE_URL;
  const [mode, setMode] = useState<AuthMode>(initialMode === 'register' ? 'register' : 'welcome');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetEmailSent, setResetEmailSent] = useState(false);
  const [pendingGoogleUser, setPendingGoogleUser] = useState<FirebaseUser | null>(null);
  const pendingGoogleUserRef = useRef<FirebaseUser | null>(null);

  useEffect(() => {
    return () => {
      if (pendingGoogleUserRef.current) void signOut();
    };
  }, []);

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    setMode(
      search.get('mode') === 'register' || initialMode === 'register' ? 'register' : 'welcome',
    );
  }, [initialMode]);

  const safeAccountRedirect = getSafeReturnTo(accountRedirect ?? null, baseUrl);
  const isGoogleRegistration = pendingGoogleUser !== null;

  const goTo = (nextMode: AuthMode) => {
    setMode(nextMode);
    setResetEmailSent(false);
    if (nextMode !== 'register' && pendingGoogleUserRef.current) {
      pendingGoogleUserRef.current = null;
      setPendingGoogleUser(null);
      void signOut();
    }
  };

  const redirectCustomer = () => {
    if (safeAccountRedirect) {
      window.location.href = safeAccountRedirect;
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const returnTo = getSafeReturnTo(params.get('returnTo'), baseUrl);
    if (params.get('account') === 'login') {
      window.location.href = `${window.location.pathname}?account=bookings`;
      return;
    }
    window.location.href = returnTo || `${baseUrl}account`;
  };

  const completeSignIn = async (user: FirebaseUser) => {
    const userRecord = await getUserRecord(user.uid);
    const role = normalizeUserRole(userRecord?.role);

    if (!userRecord || !role) {
      await signOut();
      notifyError(
        'No encontramos un perfil configurado para esta cuenta. Contacta al administrador.',
      );
      return;
    }

    sessionStorage.setItem('userRole', role);
    onSuccess?.(user.uid);

    if (safeAccountRedirect) {
      window.location.href = safeAccountRedirect;
      return;
    }
    if (new URLSearchParams(window.location.search).get('account') === 'login') {
      window.location.href = `${window.location.pathname}?account=bookings`;
      return;
    }
    const returnTo = getSafeReturnTo(
      new URLSearchParams(window.location.search).get('returnTo'),
      baseUrl,
    );
    if (returnTo) window.location.href = returnTo;
    else if (role === 'customer') redirectCustomer();
    else window.location.href = `${baseUrl}admin`;
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);

    try {
      if (mode === 'reset') {
        await requestPasswordReset(email);
        setResetEmailSent(true);
        return;
      }

      if (mode === 'register') {
        if (pendingGoogleUser) {
          await completeGoogleClientRegistration(pendingGoogleUser, name.trim(), {
            version: LEGAL_CONSENT_VERSION,
          });
          pendingGoogleUserRef.current = null;
          setPendingGoogleUser(null);
        } else {
          await signUpClient(name.trim(), email, password, { version: LEGAL_CONSENT_VERSION });
        }
        redirectCustomer();
        return;
      }

      await completeSignIn(await signIn(email, password));
    } catch (error: unknown) {
      if (pendingGoogleUserRef.current) {
        pendingGoogleUserRef.current = null;
        setPendingGoogleUser(null);
        setMode('welcome');
      }
      const message = authenticationErrorMessage(error, mode);
      notifyError(message);
      onError?.(message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    try {
      const user = await signInWithGoogle();
      const userRecord = await getUserRecord(user.uid);
      if (userRecord) {
        if (normalizeUserRole(userRecord.role)) {
          await completeSignIn(user);
          return;
        }
        await signOut();
        const message =
          'No encontramos un perfil válido para esta cuenta. Contacta al administrador.';
        notifyError(message);
        onError?.(message);
        return;
      }

      pendingGoogleUserRef.current = user;
      setPendingGoogleUser(user);
      setName(user.displayName || user.email?.split('@')[0] || '');
      goTo('register');
    } catch (error: unknown) {
      const message = authenticationErrorMessage(error, mode);
      notifyError(message);
      onError?.(message);
    } finally {
      setLoading(false);
    }
  };

  const legalNotice = (
    <p className="auth-legal-notice">
      Al crear una cuenta, aceptas los <a href={`${baseUrl}terminos-de-uso`}>Términos de uso</a>, el{' '}
      <a href={`${baseUrl}tratamiento-de-datos`}>tratamiento de datos personales</a> y el{' '}
      <a href={`${baseUrl}privacidad`}>aviso de privacidad</a>.
    </p>
  );

  return (
    <div className="login-refinement min-h-[calc(100vh-90px)] section-shell flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <button className="auth-back" type="button" onClick={() => window.history.back()}>
          Volver
        </button>
        <section className="surface-card auth-sheet" aria-labelledby="auth-title">
          {mode === 'welcome' ? (
            <>
              <h1 id="auth-title">Inicia sesión o regístrate en segundos</h1>
              <p className="auth-intro">
                Accede a tus reservas y gestiona tu cuenta con Google o tu correo.
              </p>
              <div className="auth-actions">
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={loading}
                  className="auth-provider-button"
                >
                  <span className="auth-google-mark" aria-hidden="true">
                    G
                  </span>
                  {loading ? 'Conectando…' : 'Continuar con Google'}
                </button>
                <button
                  type="button"
                  onClick={() => goTo('login')}
                  disabled={loading}
                  className="auth-provider-button"
                >
                  <svg className="auth-mail-mark" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M3.5 5.5h17v13h-17zM4.5 6.5 12 13l7.5-6.5" />
                  </svg>
                  Usar mi correo
                </button>
              </div>
              {legalNotice}
            </>
          ) : (
            <>
              <button type="button" className="auth-inline-back" onClick={() => goTo('welcome')}>
                Volver a las opciones
              </button>
              <h1 id="auth-title">
                {mode === 'login'
                  ? 'Ingresa con tu correo'
                  : mode === 'register'
                    ? 'Crea tu cuenta'
                    : 'Recupera tu contraseña'}
              </h1>
              <p className="auth-intro">
                {mode === 'login'
                  ? 'Usa el correo y la contraseña con los que creaste tu cuenta.'
                  : mode === 'register'
                    ? isGoogleRegistration
                      ? 'Confirma cómo quieres que aparezca tu nombre antes de continuar.'
                      : 'Completa estos datos una sola vez para guardar tus reservas.'
                    : 'Te enviaremos un enlace seguro para crear una nueva contraseña.'}
              </p>
              <form onSubmit={handleSubmit} className="auth-form">
                {mode === 'register' && (
                  <div>
                    <label htmlFor="name">Nombre</label>
                    <input
                      id="name"
                      type="text"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="Tu nombre"
                      required
                      disabled={loading}
                    />
                  </div>
                )}
                {!isGoogleRegistration && (
                  <div>
                    <label htmlFor="email">Correo electrónico</label>
                    <input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="tu@correo.com"
                      required
                      disabled={loading}
                    />
                  </div>
                )}
                {mode !== 'reset' && !isGoogleRegistration && (
                  <div>
                    <div className="auth-label-row">
                      <label htmlFor="password">Contraseña</label>
                      {mode === 'login' && (
                        <button type="button" onClick={() => goTo('reset')}>
                          ¿La olvidaste?
                        </button>
                      )}
                    </div>
                    <input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="Mínimo 6"
                      required
                      disabled={loading}
                    />
                  </div>
                )}
                {mode === 'reset' && resetEmailSent && (
                  <div className="password-reset-success" role="status">
                    <span aria-hidden="true">✓</span>
                    <p>
                      Si existe una cuenta asociada a <strong>{email}</strong>, recibirás un enlace
                      en unos minutos. Revisa también spam.
                    </p>
                  </div>
                )}
                <button type="submit" disabled={loading} className="btn-primary auth-submit">
                  {loading
                    ? 'Procesando…'
                    : mode === 'login'
                      ? 'Iniciar sesión'
                      : mode === 'register'
                        ? isGoogleRegistration
                          ? 'Crear mi cuenta'
                          : 'Crear mi cuenta'
                        : 'Enviar enlace de recuperación'}
                </button>
              </form>
              {mode === 'register' && !isGoogleRegistration && (
                <div className="auth-registration-alternative">
                  <div className="auth-divider" aria-hidden="true">
                    <span>o crea tu cuenta con</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleGoogleSignIn}
                    disabled={loading}
                    className="auth-provider-button"
                  >
                    <span className="auth-google-mark" aria-hidden="true">
                      G
                    </span>
                    Google
                  </button>
                </div>
              )}
              {mode === 'register' && legalNotice}
              {mode === 'login' && (
                <p className="auth-switch">
                  ¿Es tu primera vez?{' '}
                  <button type="button" onClick={() => goTo('register')}>
                    Crear cuenta
                  </button>
                </p>
              )}
              {mode === 'register' && !isGoogleRegistration && (
                <p className="auth-switch">
                  ¿Ya tienes una cuenta?{' '}
                  <button type="button" onClick={() => goTo('login')}>
                    Iniciar sesión
                  </button>
                </p>
              )}
            </>
          )}
          <p className="auth-footnote">
            Puedes agendar desde la página pública sin crear una cuenta.
          </p>
        </section>
      </div>
    </div>
  );
}
