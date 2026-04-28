import React, { useEffect, useState } from 'react';
import { getUserRecord, signIn, signOut, signUpClient } from '../../lib/auth';
import type { UserRole } from '../../lib/types';

interface LoginFormProps {
  onSuccess?: (uid: string) => void;
  onError?: (error: string) => void;
}

export default function LoginForm({ onSuccess, onError }: LoginFormProps) {
  const baseUrl = import.meta.env.BASE_URL;
  const internalRoles: UserRole[] = ['barber', 'barber_admin', 'superadmin'];
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const urlMode = search.get('mode') === 'register' ? 'register' : 'login';
    setMode(urlMode);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      if (mode === 'register') {
        await signUpClient(name.trim(), email, password);
        setSuccess('Tu cuenta fue creada como cliente. Ahora puedes iniciar sesion.');
        setMode('login');
        setPassword('');
        return;
      }

      const user = await signIn(email, password);
      const userRecord = await getUserRecord(user.uid);

      if (!userRecord || !internalRoles.includes(userRecord.role)) {
        await signOut();
        setError('Este acceso es solo para equipo interno (barberos y administradores).');
        return;
      }

      if (userRecord.role === 'superadmin') {
        if (onSuccess) {
          onSuccess(user.uid);
        }

        window.location.href = `${baseUrl}admin`;
        return;
      }

      // Etapa 5: panel de barbería pendiente. Por ahora informamos y cerramos sesión.
      await signOut();
      setSuccess('Tu usuario interno fue validado. El panel de barbería estará disponible en la Etapa 5.');
      setPassword('');
      return;
    } catch (err: any) {
      const message = err.message || 'Error al iniciar sesión';
      setError(message);
      if (onError) onError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-90px)] section-shell flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <button className="mb-4 text-sm text-subtle transition-colors cursor-pointer" onClick={() => window.history.back()}>
          &lt; Atrás
        </button>
        <div className="surface-card rounded-2xl p-5">
          <h1 className="text-3xl font-bold text-center mb-2 text-main">
            {mode === 'login' ? 'Ingresar' : 'Crear usuario'}
          </h1>
          <p className="text-center text-subtle mb-8">
            {mode === 'login'
              ? 'Acceso solo para equipo interno: barber, admin barbero y super admin.'
              : 'Registrate con nombre, correo y contraseña. Tu rol inicial será cliente.'}
          </p>

          {error && (
            <div className="mb-4 p-4 rounded-lg" style={{ background: 'color-mix(in srgb, #ef4444 14%, var(--surface))', border: '1px solid color-mix(in srgb, #ef4444 45%, var(--border))' }}>
              <p className="text-sm" style={{ color: '#fecaca' }}>{error}</p>
            </div>
          )}

          {success && (
            <div className="mb-4 p-4 rounded-lg" style={{ background: 'color-mix(in srgb, #22c55e 14%, var(--surface))', border: '1px solid color-mix(in srgb, #22c55e 45%, var(--border))' }}>
              <p className="text-sm" style={{ color: '#86efac' }}>{success}</p>
            </div>
          )}

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
                placeholder="admin@barberflow.com"
                required
                disabled={loading}
                className="w-full px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--secondary)] disabled:opacity-50"
                style={{ border: '1px solid var(--border)', background: 'var(--surface-soft)', color: 'var(--text-primary)' }}
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-subtle mb-1">
                Contrasena
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
              {loading ? 'Cargando...' : mode === 'login' ? 'Iniciar sesión' : 'Crear usuario'}
            </button>
          </form>

          <button
            type="button"
            onClick={() => {
              setError('');
              setSuccess('');
              setMode((prev) => (prev === 'login' ? 'register' : 'login'));
            }}
            className="mt-6 w-full text-sm font-semibold text-subtle hover:text-[var(--secondary)] transition-colors cursor-pointer"
          >
            {mode === 'login' ? '¿No tienes cuenta? Crear usuario' : '¿Ya tienes cuenta? Iniciar sesión'}
          </button>

          <p className="mt-3 text-center text-xs text-subtle">
            Los clientes finales reservan por la URL pública de la barbería y no necesitan iniciar sesión aquí.
          </p>
        </div>
      </div>
    </div>
  );
}
