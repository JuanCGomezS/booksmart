import React, { useState, useEffect } from 'react';
import { createBarber } from '../../../lib/barbers';
import { BILLING_CYCLE_LABEL, BUSINESS_TYPE_LABEL, DATA, PLAN_LABEL } from '../../../lib/data';
import { getBarberAdmins } from '../../../lib/users';
import type { BillingCycle, BusinessType, Plan, User } from '../../../lib/types';
import FancySelect, { type FancySelectOption } from '../FancySelect';

interface CreateBarberFormProps {
  onSuccess: () => void;
}

export default function CreateBarberForm({ onSuccess }: CreateBarberFormProps) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [plan, setPlan] = useState<Plan>(DATA.PLAN.STANDARD);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>(DATA.BILLING_CYCLE.MONTH_1);
  const [businessType, setBusinessType] = useState<BusinessType>('barbershop');
  const [loading, setLoading] = useState(false);
  const [loadingAdmins, setLoadingAdmins] = useState(true);
  const [error, setError] = useState('');
  const [admins, setAdmins] = useState<User[]>([]);

  const adminOptions: FancySelectOption<string>[] = admins.map((admin) => ({
    value: admin.email,
    label: admin.email,
  }));

  const planOptions: FancySelectOption<string>[] = [
    { value: DATA.PLAN.STANDARD, label: PLAN_LABEL[DATA.PLAN.STANDARD] },
    { value: DATA.PLAN.PLUS, label: PLAN_LABEL[DATA.PLAN.PLUS] },
    { value: DATA.PLAN.EXTRA, label: PLAN_LABEL[DATA.PLAN.EXTRA] },
  ];

  const billingOptions: FancySelectOption<string>[] = [
    { value: DATA.BILLING_CYCLE.MONTH_1, label: BILLING_CYCLE_LABEL[DATA.BILLING_CYCLE.MONTH_1] },
    { value: DATA.BILLING_CYCLE.MONTH_3, label: BILLING_CYCLE_LABEL[DATA.BILLING_CYCLE.MONTH_3] },
    { value: DATA.BILLING_CYCLE.MONTH_12, label: BILLING_CYCLE_LABEL[DATA.BILLING_CYCLE.MONTH_12] },
  ];
  const businessTypeOptions: FancySelectOption<string>[] = Object.entries(BUSINESS_TYPE_LABEL).map(([value, label]) => ({ value, label }));

  // Cargar administradores del negocio (rol heredado).
  useEffect(() => {
    loadAdmins();
  }, []);

  const loadAdmins = async () => {
    setLoadingAdmins(true);
    try {
      const data = await getBarberAdmins();
      setAdmins(data);
    } catch (err) {
      console.error('Error loading admins:', err);
      setError('Error cargando administradores');
    } finally {
      setLoadingAdmins(false);
    }
  };

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

    if (!name || !slug || !ownerEmail) {
      setError('Por favor completa todos los campos');
      setLoading(false);
      return;
    }

    try {
      const result = await createBarber(ownerEmail, name, slug, plan, billingCycle, businessType);
      
      if (result) {
        setName('');
        setSlug('');
        setOwnerEmail('');
        setPlan(DATA.PLAN.STANDARD);
        setBillingCycle(DATA.BILLING_CYCLE.MONTH_1);
        setBusinessType('barbershop');
        onSuccess();
      } else {
        setError('Error al crear el negocio');
      }
    } catch (err) {
      setError('Error al crear el negocio');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="surface-card rounded-lg p-8 mb-8">
      <h2 className="text-2xl font-bold mb-6 text-main">Crear nuevo negocio</h2>

      {error && (
        <div className="mb-4 p-4 rounded-lg" style={{ background: 'color-mix(in srgb, #ef4444 14%, var(--surface))', border: '1px solid color-mix(in srgb, #ef4444 45%, var(--border))' }}>
          <p style={{ color: '#fecaca' }}>{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="field-label block text-sm font-medium mb-1">
              Nombre del negocio
            </label>
            <input
              type="text"
              value={name}
              onChange={handleNameChange}
              placeholder="Ej: Estudio Aurora"
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
              placeholder="ej: estudio-aurora"
              required
              disabled={loading}
              className="field-input"
            />
            <p className="field-hint text-xs mt-1">URL: /b/{slug}</p>
          </div>

          <div>
            <label className="field-label block text-sm font-medium mb-1">
              Administrador (email)
            </label>
            <FancySelect
              value={ownerEmail}
              onChange={setOwnerEmail}
              options={adminOptions}
              placeholder={loadingAdmins ? 'Cargando...' : admins.length === 0 ? 'No hay admins disponibles' : 'Selecciona un administrador'}
              disabled={loading || loadingAdmins}
            />
            <p className="field-hint text-xs mt-1">Solo se muestran usuarios con rol de administrador del negocio</p>
          </div>

          <div>
            <label className="field-label block text-sm font-medium mb-1">Tipo de negocio</label>
            <FancySelect value={businessType} onChange={(value) => setBusinessType(value as BusinessType)} options={businessTypeOptions} disabled={loading} />
          </div>

          <div>
            <label className="field-label block text-sm font-medium mb-1">
              Plan inicial
            </label>
            <FancySelect
              value={plan}
              onChange={(nextPlan) => setPlan(nextPlan as Plan)}
              options={planOptions}
              disabled={loading}
            />
          </div>

          <div>
            <label className="field-label block text-sm font-medium mb-1">
              Ciclo de facturación
            </label>
            <FancySelect
              value={billingCycle}
              onChange={(nextBillingCycle) => setBillingCycle(nextBillingCycle as BillingCycle)}
              options={billingOptions}
              disabled={loading}
            />
          </div>
        </div>

        <div className="flex gap-4 pt-4">
          <button
            type="submit"
            disabled={loading || loadingAdmins}
            className="btn-primary px-8 py-2 rounded-lg transition-colors disabled:opacity-50 font-semibold"
          >
            {loading ? 'Creando...' : 'Crear negocio'}
          </button>
        </div>
      </form>
    </div>
  );
}
