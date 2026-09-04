import { useEffect, useState } from 'react';
import { improvePublicAssistantContext } from '../../../lib/public-assistant.ts';
import { updateBarberPublicAssistantContext } from '../../../lib/barbers.ts';
import { notifyError, notifySuccess } from '../FloatingNotifications';

type Props = {
  businessId: string;
  initialContext?: string;
  onChange: () => void | Promise<void>;
};

const MAX_CONTEXT_LENGTH = 6_000;

function errorMessage(cause: unknown) {
  const code =
    typeof cause === 'object' && cause !== null && 'code' in cause
      ? (cause as { code?: unknown }).code
      : undefined;
  const normalizedCode = typeof code === 'string' ? code.replace(/^functions\//, '') : '';
  if (normalizedCode === 'resource-exhausted')
    return 'La mejora con IA no está disponible en este momento.';
  if (normalizedCode === 'failed-precondition')
    return 'Configura la integración de IA antes de mejorar el texto.';
  return cause instanceof Error ? cause.message : 'No fue posible completar la solicitud.';
}

export default function PublicAssistantConfiguration({
  businessId,
  initialContext = '',
  onChange,
}: Props) {
  const [context, setContext] = useState(initialContext);
  const [saving, setSaving] = useState(false);
  const [improving, setImproving] = useState(false);
  useEffect(() => {
    setContext(initialContext);
  }, [businessId, initialContext]);

  const save = async () => {
    setSaving(true);
    try {
      await updateBarberPublicAssistantContext(businessId, context);
      await onChange();
      notifySuccess('Perfil publicado.');
    } catch (cause) {
      notifyError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const improve = async () => {
    setImproving(true);
    try {
      const improved = await improvePublicAssistantContext(businessId, context);
      setContext(improved);
      notifySuccess('Propuesta lista para revisar y publicar.');
    } catch (cause) {
      notifyError(errorMessage(cause));
    } finally {
      setImproving(false);
    }
  };

  return (
    <section className="surface-card max-w-3xl rounded-2xl p-6" aria-labelledby="assistant-title">
      <h2 id="assistant-title" className="text-xl font-bold text-main">
        Asistente público
      </h2>
      <p className="mt-2 max-w-prose text-sm text-subtle">
        Este texto es público: el asistente puede usarlo para responder a cualquier visitante.
        También usa los servicios, horarios, productos y profesionales públicos de este negocio. No
        escribas datos de clientes, información clínica ni instrucciones internas: el texto se
        procesa con un proveedor de IA.
      </p>
      <label className="field-label mt-6 block" htmlFor="public-assistant-context">
        Información pública para clientes
      </label>
      <textarea
        id="public-assistant-context"
        className="field-input mt-2 min-h-64 w-full resize-y"
        value={context}
        maxLength={MAX_CONTEXT_LENGTH}
        disabled={saving || improving}
        onChange={(event) => setContext(event.target.value)}
        placeholder="Por ejemplo: medios de pago, parqueadero, políticas, accesibilidad, recomendaciones y preguntas frecuentes."
      />
      <p className="mt-2 text-sm text-subtle" aria-live="polite">
        {context.length.toLocaleString('es-CO')} / {MAX_CONTEXT_LENGTH.toLocaleString('es-CO')}{' '}
        caracteres
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          className="btn-outline rounded-lg px-4 py-2 disabled:opacity-50"
          disabled={saving || improving}
          onClick={() => void improve()}
        >
          {improving ? 'Mejorando…' : 'Mejorar con IA'}
        </button>
        <button
          type="button"
          className="btn-primary rounded-lg px-4 py-2 disabled:opacity-50"
          disabled={saving || improving}
          onClick={() => void save()}
        >
          {saving ? 'Publicando…' : 'Publicar contexto'}
        </button>
      </div>
    </section>
  );
}
