import React, { useState, useEffect } from 'react';
import { getAllBarbers, getBarberStatus } from '../../lib/barbers';
import { DATA } from '../../lib/data';
import type { Barber } from '../../lib/types';
import BarbersList from './admin/BarbersList';
import CreateBarberForm from './admin/CreateBarberForm';
import UsersRolesManager from './admin/UsersRolesManager';

export default function SuperAdminApp() {
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadBarbers();
  }, []);

  const loadBarbers = async () => {
    setLoading(true);
    setError('');
    try {
      const barbersData = await getAllBarbers();
      setBarbers(barbersData);
      
    } catch (err) {
      setError('Error cargando negocios');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleBarberCreated = () => {
    setShowCreateForm(false);
    loadBarbers();
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center section-shell">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 mx-auto mb-4" style={{ borderColor: 'var(--secondary)' }}></div>
          <p className="text-subtle">Cargando negocios...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="section-shell">
      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-main">BookSmart Admin</h1>
          <p className="text-subtle text-sm">Control de negocios por cita</p>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-lg" style={{ background: 'color-mix(in srgb, #ef4444 14%, var(--surface))', border: '1px solid color-mix(in srgb, #ef4444 45%, var(--border))' }}>
            <p style={{ color: '#fecaca' }}>{error}</p>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="surface-card rounded-lg p-6">
            <p className="text-subtle text-sm">Total de negocios</p>
            <p className="text-3xl font-bold text-main">{barbers.length}</p>
          </div>
          <div className="surface-card rounded-lg p-6">
            <p className="text-subtle text-sm">Activas</p>
            <p className="text-3xl font-bold" style={{ color: 'var(--success)' }}>
              {barbers.filter(b => getBarberStatus(b) === DATA.BARBER_STATUS.ACTIVE).length}
            </p>
          </div>
          <div className="surface-card rounded-lg p-6">
            <p className="text-subtle text-sm">En prueba</p>
            <p className="text-3xl font-bold" style={{ color: 'var(--accent)' }}>
              {barbers.filter(b => getBarberStatus(b) === DATA.BARBER_STATUS.TRIAL).length}
            </p>
          </div>
          <div className="surface-card rounded-lg p-6">
            <p className="text-subtle text-sm">Expiradas</p>
            <p className="text-3xl font-bold" style={{ color: '#ef4444' }}>
              {barbers.filter(b => getBarberStatus(b) === DATA.BARBER_STATUS.EXPIRED).length}
            </p>
          </div>
        </div>

        {/* Create button */}
        <div className="mb-8">
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="btn-primary px-8 py-3 rounded-xl transition-colors font-semibold"
          >
            {showCreateForm ? 'Cancelar' : '+ Nuevo negocio'}
          </button>
        </div>

        {/* Create form */}
        {showCreateForm && (
          <CreateBarberForm onSuccess={handleBarberCreated} />
        )}

        {/* Barbers list */}
        <BarbersList 
          barbers={barbers} 
          onRefresh={loadBarbers}
        />

        <div className="mt-8">
          <UsersRolesManager />
        </div>
      </main>
    </div>
  );
}
