import React, { useState } from 'react';
import { createBarber } from '../../../lib/barbers';

interface CreateBarberFormProps {
  onSuccess: () => void;
}

export default function CreateBarberForm({ onSuccess }: CreateBarberFormProps) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [plan, setPlan] = useState('standard');
  const [billingCycle, setBillingCycle] = useState('month_1');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Auto-generate slug from name
  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setName(value);
    setSlug(value.toLowerCase().replace(/\s+/g, '-'));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (!name || !slug || !ownerId) {
      setError('Por favor completa todos los campos');
      setLoading(false);
      return;
    }

    try {
      const result = await createBarber(ownerId, name, slug, plan as any, billingCycle as any);
      
      if (result) {
        setName('');
        setSlug('');
        setOwnerId('');
        setPlan('standard');
        setBillingCycle('month_1');
        onSuccess();
      } else {
        setError('Error al crear barbería');
      }
    } catch (err) {
      setError('Error al crear barbería');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="surface-card rounded-lg p-8 mb-8">
      <h2 className="text-2xl font-bold mb-6 text-main">Crear nueva barbería</h2>

      {error && (
        <div className="mb-4 p-4 rounded-lg" style={{ background: 'color-mix(in srgb, #ef4444 14%, var(--surface))', border: '1px solid color-mix(in srgb, #ef4444 45%, var(--border))' }}>
          <p style={{ color: '#fecaca' }}>{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="field-label block text-sm font-medium mb-1">
              Nombre de la barbería
            </label>
            <input
              type="text"
              value={name}
              onChange={handleNameChange}
              placeholder="Ej: Barber Shop Javier"
              required
              disabled={loading}
              className="field-input"
            />
          </div>

          <div>
            <label className="field-label block text-sm font-medium mb-1">
              Slug (ID en URL)
            </label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="ej: barber-shop-javier"
              required
              disabled={loading}
              className="field-input"
            />
            <p className="field-hint text-xs mt-1">URL: /b/{slug}</p>
          </div>

          <div>
            <label className="field-label block text-sm font-medium mb-1">
              UID del propietario
            </label>
            <input
              type="text"
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
              placeholder="UID de Firebase del admin"
              required
              disabled={loading}
              className="field-input"
            />
            <p className="field-hint text-xs mt-1">Se debe crear el usuario en Firebase Auth primero</p>
          </div>

          <div>
            <label className="field-label block text-sm font-medium mb-1">
              Plan inicial
            </label>
            <select
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
              disabled={loading}
              className="field-select"
            >
              <option value="standard">Estándar</option>
              <option value="plus">Plus</option>
              <option value="extra">Extra</option>
            </select>
          </div>

          <div>
            <label className="field-label block text-sm font-medium mb-1">
              Ciclo de facturación
            </label>
            <select
              value={billingCycle}
              onChange={(e) => setBillingCycle(e.target.value)}
              disabled={loading}
              className="field-select"
            >
              <option value="month_1">1 mes</option>
              <option value="month_3">3 meses</option>
              <option value="month_12">12 meses</option>
            </select>
          </div>
        </div>

        <div className="flex gap-4 pt-4">
          <button
            type="submit"
            disabled={loading}
            className="btn-primary px-8 py-2 rounded-lg transition-colors disabled:opacity-50 font-semibold"
          >
            {loading ? 'Creando...' : 'Crear barbería'}
          </button>
        </div>
      </form>
    </div>
  );
}
