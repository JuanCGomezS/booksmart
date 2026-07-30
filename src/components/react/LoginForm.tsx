import React, { useEffect, useState } from 'react';
import { getUserRecord, signIn, signOut, signUpClient } from '../../lib/auth';
import { normalizeUserRole } from '../../lib/roles';
import { getSafeReturnTo } from '../../lib/return-to';
import { notifyError } from './FloatingNotifications';

interface LoginFormProps {
  onSuccess?: (uid: string) => void;
  onError?: (error: string) => void;
}

function authenticationErrorMessage(error: unknown, mode: 'login' | 'register'): string {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? (error as { code?: string }).code
    : undefined;

  switch (code) {
    case 'auth/invalid-email':
      return 'Escribe un correo electrónico válido.';
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return 'El correo o la contraseña no coinciden. Verifícalos e inténtalo nuevamente.';
    case 'auth/user-disabled':
      return 'Esta cuenta está deshabilitada. Comunícate con el administrador para recuperar el acceso.';
    case 'auth/email-already-in-use':
      return 'Ya existe una cuenta con este correo. Inicia sesión o usa otro correo electrónico.';
    case 'auth/weak-password':
      return 'La contraseña debe tener al menos seis caracteres. Corrígela e inténtalo nuevamente.';
    case 'auth/network-request-failed':
      return 'No fue posible conectar con el servicio. Verifica tu conexión e inténtalo nuevamente.';
    case 'auth/too-many-requests':
      return 'Se bloquearon temporalmente los intentos de acceso. Espera unos minutos antes de intentarlo nuevamente.';
    case 'auth/operation-not-allowed':
      return 'Esta operación no está disponible en este momento. Inténtalo más tarde.';
    default:
      return mode === 'login'
        ? 'No fue posible iniciar sesión. Verifica tus datos e inténtalo nuevamente.'
        : 'No fue posible crear la cuenta. Verifica tus datos e inténtalo nuevamente.';
  }
}

export default function LoginForm({ onSuccess, onError }: LoginFormProps) {
  const baseUrl = import.meta.env.BASE_URL;
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const urlMode = search.get('mode') === 'register' ? 'register' : 'login';
    setMode(urlMode);
  }, []);

  const redirectCustomer = () => {
    const returnTo = getSafeReturnTo(new URLSearchParams(window.location.search).get('returnTo'), baseUrl);
    window.location.href = returnTo || `${baseUrl}account`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (mode === 'register') {
        await signUpClient(name.trim(), email, password);
        redirectCustomer();
        return;
      }

      const user = await signIn(email, password);
      const userRecord = await getUserRecord(user.uid);

      const role = normalizeUserRole(userRecord?.role);
      if (!userRecord || !role) {
        await signOut();
        notifyError('No fue posible cargar esta cuenta. Inténtalo nuevamente.');
        return;
      }

      sessionStorage.setItem('userRole', role);

      if (onSuccess) onSuccess(user.uid);

      if (role === 'customer') {
        redirectCustomer();
      } else {
        window.location.href = `${baseUrl}admin`;
      }
    } catch (err: unknown) {
      const message = authenticationErrorMessage(err, mode);
      notifyError(message);
      if (onError) onError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-refinement min-h-[calc(100vh-90px)] section-shell flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <button className="mb-4 text-sm text-subtle transition-colors cursor-pointer" onClick={() => window.history.back()}>
          &lt; Volver
        </button>
        <div className="surface-card rounded-2xl p-5">
          <h1 className="text-3xl font-bold text-center mb-2 text-main">
            {mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}
          </h1>
          <p className="text-center text-subtle mb-8">
            {mode === 'login'
              ? 'Inicia sesión para administrar tu negocio o unirte como parte del personal.'
              : 'Crea tu cuenta y luego únete a un negocio con su código.'}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-subtle mb-1">
                  Nombre
                </label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Tu nombre"
                  required
                  disabled={loading}
                  className="w-full px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--secondary)] disabled:opacity-50"
                  style={{ border: '1px solid var(--border)', background: 'var(--surface-soft)', color: 'var(--text-primary)' }}
                />
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-subtle mb-1">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@booksmart.com"
                required
                disabled={loading}
                className="w-full px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--secondary)] disabled:opacity-50"
                style={{ border: '1px solid var(--border)', background: 'var(--surface-soft)', color: 'var(--text-primary)' }}
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-subtle mb-1">
                  Contraseña
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                disabled={loading}
                className="w-full px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--secondary)] disabled:opacity-50"
                style={{ border: '1px solid var(--border)', background: 'var(--surface-soft)', color: 'var(--text-primary)' }}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full font-semibold py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-6 cursor-pointer"
            >
              {loading ? 'Cargando…' : mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}
            </button>
          </form>

          <button
            type="button"
            onClick={() => {
              setMode((prev) => (prev === 'login' ? 'register' : 'login'));
            }}
            className="mt-6 w-full text-sm font-semibold text-subtle hover:text-[var(--secondary)] transition-colors cursor-pointer"
          >
            {mode === 'login' ? '¿No tienes una cuenta? Crea una' : '¿Ya tienes una cuenta? Inicia sesión'}
          </button>

          <p className="mt-3 text-center text-xs text-subtle">
            Las personas pueden reservar desde la página pública sin iniciar sesión.
          </p>
        </div>
      </div>
    </div>
  );
}
