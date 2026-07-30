import React, { useState, useEffect } from 'react';
import { getAllBarbers, getBarberStatus } from '../../lib/barbers';
import { DATA } from '../../lib/data';
import type { Barber } from '../../lib/types';
import BarbersList from './admin/BarbersList';
import CreateBarberForm from './admin/CreateBarberForm';
import { notifySuccess } from './FloatingNotifications';

export default function SuperAdminApp({ onSelectBusiness }: { onSelectBusiness: (barber: Barber) => void }) {
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
    notifySuccess('El negocio se creó y la cuenta seleccionada ahora es Storeadmin.');
    loadBarbers();
  };

  if (loading) {
    return (
      <div className="super-admin-workspace section-shell min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin mx-auto mb-4 h-10 w-10 border-2" style={{ borderColor: 'var(--secondary)' }}></div>
          <p className="text-subtle">Cargando negocios...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="super-admin-workspace section-shell">
      {/* Main content */}
      <main className="super-admin-content max-w-7xl mx-auto px-4 py-10 sm:py-12">
        <div className="super-admin-header mb-10">
          <p className="super-admin-eyebrow">Control de plataforma</p>
          <h1 className="mt-2 text-3xl font-bold">BookSmart Admin</h1>
          <p className="mt-2 text-sm">Control de negocios por cita</p>
        </div>

        {error && (
          <div className="status-cancelled mb-6 flex flex-wrap items-center gap-3 rounded border p-4" role="alert">
            <p>{error}</p>
            <button type="button" className="btn-outline px-3 py-1 text-sm" onClick={() => void loadBarbers()}>Reintentar</button>
          </div>
        )}

        {/* Stats */}
        <div className="super-admin-metrics mb-10">
          <div className="super-admin-metric-primary surface-card p-7">
            <p className="text-subtle text-sm">Total de negocios</p>
            <p className="text-5xl font-semibold text-main">{barbers.length}</p>
          </div>
          <div className="super-admin-metric-statuses" aria-label="Estado de negocios">
            <div>
              <p className="text-subtle text-sm">Activas</p>
              <p className="text-xl font-semibold" style={{ color: 'var(--success)' }}>
                {barbers.filter(b => getBarberStatus(b) === DATA.BARBER_STATUS.ACTIVE).length}
              </p>
            </div>
            <div>
              <p className="text-subtle text-sm">En prueba</p>
              <p className="status-trial-fg text-xl font-semibold">
                {barbers.filter(b => getBarberStatus(b) === DATA.BARBER_STATUS.TRIAL).length}
              </p>
            </div>
            <div>
              <p className="text-subtle text-sm">Expiradas</p>
              <p className="text-xl font-semibold" style={{ color: 'var(--danger)' }}>
                {barbers.filter(b => getBarberStatus(b) === DATA.BARBER_STATUS.EXPIRED).length}
              </p>
            </div>
          </div>
        </div>

        {/* Create button */}
        <div className="mb-8">
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="btn-primary super-admin-action px-6 py-3 font-semibold"
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
          onSelect={onSelectBusiness}
        />

      </main>
    </div>
  );
}
