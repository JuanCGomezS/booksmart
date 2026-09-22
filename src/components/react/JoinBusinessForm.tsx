import { useState, type FormEvent } from 'react';
import { formatStaffEnrollmentCode, joinBusinessWithCode } from '../../lib/staff-enrollment';
import { notifyError } from './FloatingNotifications';

export default function JoinBusinessForm({
  onJoined,
  className = 'mt-7 space-y-4',
}: {
  onJoined?: () => void;
  className?: string;
}) {
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      await joinBusinessWithCode(code);
      setCode('');
      onJoined?.();
    } catch (cause) {
      notifyError(
        cause instanceof Error
          ? cause.message
          : 'No fue posible unirte al negocio. Revisa el código e inténtalo nuevamente.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className={className} onSubmit={(event) => void submit(event)}>
      <label className="block text-sm font-semibold text-main" htmlFor="business-code">
        Código del negocio
        <input
          id="business-code"
          autoComplete="off"
          spellCheck={false}
          value={code}
          onChange={(event) => setCode(formatStaffEnrollmentCode(event.target.value))}
          placeholder="ABCDE-FGHIJ-KLMNO-PQRST-UVWXY-Z"
          className="field-input mt-2 w-full uppercase"
          disabled={submitting}
          required
        />
      </label>
      <button
        type="submit"
        className="btn-primary w-full rounded-lg px-4 py-3 font-semibold disabled:opacity-50"
        disabled={submitting}
      >
        {submitting ? 'Uniéndote al negocio…' : 'Unirme al negocio'}
      </button>
    </form>
  );
}
