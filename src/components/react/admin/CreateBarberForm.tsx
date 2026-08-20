import React, { useState } from 'react';
import { BusinessCreationError, createBarber } from '../../../lib/barbers';
import { BILLING_CYCLE_LABEL, BUSINESS_TYPE_LABEL, DATA, PLAN_LABEL } from '../../../lib/data';
import type { BillingCycle, BusinessType, Plan } from '../../../lib/types';
import FancySelect, { type FancySelectOption } from '../FancySelect';
import { notifyError } from '../FloatingNotifications';

interface CreateBarberFormProps {
  onSuccess: () => void;
}

type FieldName = 'name' | 'slug' | 'ownerEmail';
type FieldErrors = Partial<Record<FieldName, string>>;

function creationErrorMessage(error: unknown): string {
  if (!(error instanceof BusinessCreationError)) {
    return 'No fue posible completar la creación. Verifica tu conexión e inténtalo nuevamente.';
  }

  switch (error.code) {
    case 'not-authenticated':
      return 'Tu sesión ya no está activa. Inicia sesión nuevamente para crear el negocio.';
    case 'owner-not-found':
      return 'No existe una cuenta Customer con ese correo electrónico.';
    case 'self-owner':
      return 'No puedes asignarte como propietario del negocio desde esta operación.';
    case 'owner-not-customer':
      return 'La cuenta seleccionada debe tener el rol Customer antes de crear su primer negocio.';
    case 'owner-already-assigned':
      return 'La cuenta seleccionada ya tiene una asignación de negocio y no puede usarse para esta creación.';
    case 'permission-denied':
      return 'No tienes permisos para crear este negocio. Verifica que tu cuenta siga siendo Superadministrador.';
    case 'unavailable':
      return 'No se pudo contactar el servicio. Verifica tu conexión e inténtalo nuevamente.';
    case 'conflict':
      return 'La cuenta seleccionada cambió mientras se creaba el negocio. Revisa sus datos e inténtalo nuevamente.';
    default:
      return 'No fue posible completar la creación. Verifica los datos e inténtalo nuevamente.';
  }
}

function creationFieldErrors(error: unknown): FieldErrors {
  if (!(error instanceof BusinessCreationError)) return {};

  switch (error.code) {
    case 'owner-not-found':
    case 'self-owner':
    case 'owner-not-customer':
    case 'owner-already-assigned':
    case 'conflict':
      return { ownerEmail: creationErrorMessage(error) };
    default:
      return {};
  }
}

export default function CreateBarberForm({ onSuccess }: CreateBarberFormProps) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [plan, setPlan] = useState<Plan>(DATA.PLAN.STANDARD);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>(DATA.BILLING_CYCLE.MONTH_1);
  const [businessType, setBusinessType] = useState<BusinessType>('barbershop');
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

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
  const businessTypeOptions: FancySelectOption<string>[] = Object.entries(BUSINESS_TYPE_LABEL).map(
    ([value, label]) => ({ value, label }),
  );

  // Auto-generate slug from name
  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setName(value);
    setSlug(value.toLowerCase().replace(/\s+/g, '-'));
    setFieldErrors((current) => ({ ...current, name: undefined, slug: undefined }));
  };

  const clearFieldError = (field: FieldName) => {
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const validationErrors: FieldErrors = {
      name: name.trim() ? undefined : 'Escribe el nombre del negocio.',
      slug: slug.trim() ? undefined : 'Escribe el identificador que se usará en la URL.',
      ownerEmail: !ownerEmail.trim()
        ? 'Escribe el correo electrónico del propietario inicial.'
        : !/^\S+@\S+\.\S+$/.test(ownerEmail)
          ? 'Escribe un correo electrónico válido.'
          : undefined,
    };
    if (Object.values(validationErrors).some(Boolean)) {
      setFieldErrors(validationErrors);
      return;
    }

    setFieldErrors({});
    setLoading(true);
    try {
      await createBarber(ownerEmail, name, slug, plan, billingCycle, businessType);
      setName('');
      setSlug('');
      setOwnerEmail('');
      setPlan(DATA.PLAN.STANDARD);
      setBillingCycle(DATA.BILLING_CYCLE.MONTH_1);
      setBusinessType('barbershop');
      onSuccess();
    } catch (err) {
      const message = creationErrorMessage(err);
      const errors = creationFieldErrors(err);
      setFieldErrors(errors);
      if (!errors.ownerEmail) {
        notifyError(message);
      }
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="super-admin-surface super-admin-form surface-card p-8 mb-8">
      <h2 className="text-2xl font-bold mb-6 text-main">Crear nuevo negocio</h2>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="business-name" className="field-label block text-sm font-medium mb-1">
              Nombre del negocio
            </label>
            <input
              type="text"
              id="business-name"
              value={name}
              onChange={handleNameChange}
              placeholder="Ej: Estudio Aurora"
              required
              disabled={loading}
              className="field-input"
              aria-invalid={Boolean(fieldErrors.name)}
              aria-describedby={fieldErrors.name ? 'business-name-error' : undefined}
            />
            {fieldErrors.name && (
              <p id="business-name-error" className="error-message text-xs mt-1" role="alert">
                {fieldErrors.name}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="business-slug" className="field-label block text-sm font-medium mb-1">
              Slug (ID en URL)
            </label>
            <input
              type="text"
              id="business-slug"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                clearFieldError('slug');
              }}
              placeholder="ej: estudio-aurora"
              required
              disabled={loading}
              className="field-input"
              aria-invalid={Boolean(fieldErrors.slug)}
              aria-describedby={
                fieldErrors.slug ? 'business-slug-hint business-slug-error' : 'business-slug-hint'
              }
            />
            <p id="business-slug-hint" className="field-hint text-xs mt-1">
              URL: /b/{slug}
            </p>
            {fieldErrors.slug && (
              <p id="business-slug-error" className="error-message text-xs mt-1" role="alert">
                {fieldErrors.slug}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="business-owner-email"
              className="field-label block text-sm font-medium mb-1"
            >
              Propietario inicial (correo electrónico)
            </label>
            <input
              id="business-owner-email"
              type="email"
              value={ownerEmail}
              onChange={(event) => {
                setOwnerEmail(event.target.value);
                clearFieldError('ownerEmail');
              }}
              placeholder="customer@example.com"
              required
              disabled={loading}
              className="field-input"
              aria-invalid={Boolean(fieldErrors.ownerEmail)}
              aria-describedby={
                fieldErrors.ownerEmail
                  ? 'business-owner-email-hint business-owner-email-error'
                  : 'business-owner-email-hint'
              }
            />
            <p id="business-owner-email-hint" className="field-hint text-xs mt-1">
              Debe corresponder a una cuenta Customer existente. Al crear el negocio, esa cuenta se
              promoverá a Storeadmin y recibirá su primera asignación.
            </p>
            {fieldErrors.ownerEmail && (
              <p
                id="business-owner-email-error"
                className="error-message text-xs mt-1"
                role="alert"
              >
                {fieldErrors.ownerEmail}
              </p>
            )}
          </div>

          <div>
            <label className="field-label block text-sm font-medium mb-1">Tipo de negocio</label>
            <FancySelect
              value={businessType}
              onChange={(value) => setBusinessType(value as BusinessType)}
              options={businessTypeOptions}
              disabled={loading}
              menuClassName="super-admin-select-menu"
            />
          </div>

          <div>
            <label className="field-label block text-sm font-medium mb-1">Plan inicial</label>
            <FancySelect
              value={plan}
              onChange={(nextPlan) => setPlan(nextPlan as Plan)}
              options={planOptions}
              disabled={loading}
              menuClassName="super-admin-select-menu"
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
              menuClassName="super-admin-select-menu"
            />
          </div>
        </div>

        <div className="flex gap-4 pt-4">
          <button
            type="submit"
            disabled={loading}
            className="btn-primary super-admin-action px-6 py-2 transition-colors disabled:opacity-50 font-semibold"
          >
            {loading ? 'Creando...' : 'Crear negocio'}
          </button>
        </div>
      </form>
    </div>
  );
}
