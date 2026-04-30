import React, { useEffect, useState } from 'react';
import { getCurrentUser } from '../../lib/auth';
import type { UserRole } from '../../lib/types';

interface AuthGuardProps {
  children: React.ReactNode;
  requiredRole?: UserRole;
  fallback?: React.ReactNode;
}

export default function AuthGuard({ 
  children, 
  requiredRole = 'superadmin',
  fallback 
}: AuthGuardProps) {
  const baseUrl = import.meta.env.BASE_URL;
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);

  useEffect(() => {
    const checkAuth = async () => {
      const cachedRole = sessionStorage.getItem('userRole');
      if (cachedRole === requiredRole) {
        setIsAuthorized(true);
        return;
      }
      
      const user = await getCurrentUser();
      
      if (!user) {
        window.location.href = `${baseUrl}login`;
        return;
      }

      // Verificar rol requerido
      if (requiredRole && user.userRecord?.role !== requiredRole) {
        setIsAuthorized(false);
        return;
      }

      sessionStorage.setItem('userRole', user.userRecord?.role || '');
      setIsAuthorized(true);
    };

    checkAuth();
  }, [requiredRole]);

  // Mientras verifica
  if (isAuthorized === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-black mx-auto mb-4"></div>
          <p className="text-gray-600">Verificando acceso...</p>
        </div>
      </div>
    );
  }

  // Sin autorización
  if (!isAuthorized) {
    return fallback || (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="bg-white rounded-lg shadow p-8 max-w-md text-center">
          <h1 className="text-2xl font-bold mb-2 text-gray-900">Acceso denegado</h1>
          <p className="text-gray-600 mb-4">
            No tienes permiso para acceder a esta sección.
          </p>
          <a
            href={baseUrl}
            className="inline-block bg-black text-white px-6 py-2 rounded-lg hover:bg-gray-900 transition-colors"
          >
            Volver a inicio
          </a>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
