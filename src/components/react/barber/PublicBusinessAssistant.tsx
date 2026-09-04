import { type FormEvent, useEffect, useRef, useState } from 'react';
import { askPublicBusinessAssistant } from '../../../lib/public-assistant.ts';

type Props = {
  businessName: string;
  slug: string;
};

type Message = {
  id: string;
  author: 'visitor' | 'sofia';
  content: string;
};

const EXAMPLES = [
  '¿Qué servicios ofrecen?',
  '¿Cuál es el horario?',
  '¿Qué medios de pago aceptan?',
];

function errorMessage(cause: unknown) {
  const code =
    typeof cause === 'object' && cause !== null && 'code' in cause
      ? (cause as { code?: unknown }).code
      : undefined;
  const normalizedCode = typeof code === 'string' ? code.replace(/^functions\//, '') : '';
  if (normalizedCode === 'resource-exhausted')
    return 'Alcanzaste el límite diario de preguntas. Inténtalo mañana.';
  if (normalizedCode === 'not-found' || normalizedCode === 'permission-denied')
    return 'SofIA no está disponible para este negocio.';
  return 'No pude responder ahora. Inténtalo de nuevo.';
}

function SofiaMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}

export default function PublicBusinessAssistant({ businessName, slug }: Props) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const conversationEndRef = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  useEffect(() => {
    conversationEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, loading]);

  const ask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = question.trim();
    if (!value || loading) return;
    const visitorMessage: Message = {
      id: crypto.randomUUID(),
      author: 'visitor',
      content: value,
    };
    setMessages((current) => [...current, visitorMessage]);
    setQuestion('');
    setError('');
    setLoading(true);
    try {
      const answer = await askPublicBusinessAssistant(slug, value);
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), author: 'sofia', content: answer },
      ]);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  };

  const askExample = (example: string) => {
    setQuestion(example);
    inputRef.current?.focus();
  };

  return (
    <aside
      className={`sofia-chat ${open ? 'is-open' : ''}`}
      aria-label={`SofIA de ${businessName}`}
    >
      {open && (
        <section
          id="sofia-chat-panel"
          className="sofia-chat-panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby="sofia-title"
        >
          <header className="sofia-chat-header">
            <div className="sofia-chat-identity">
              <span className="sofia-chat-mark">
                <SofiaMark />
              </span>
              <div>
                <h2 id="sofia-title">SofIA</h2>
                <p>Asistente de {businessName}</p>
              </div>
            </div>
            <button
              type="button"
              className="sofia-chat-close"
              aria-label="Cerrar chat"
              onClick={close}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </button>
          </header>
          <div className="sofia-chat-conversation" aria-live="polite">
            {messages.length === 0 && (
              <div className="sofia-chat-welcome">
                <p>Hola, soy SofIA. Puedo ayudarte con información de este negocio.</p>
                <div className="sofia-chat-examples">
                  {EXAMPLES.map((example) => (
                    <button key={example} type="button" onClick={() => askExample(example)}>
                      {example}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((message) => (
              <p key={message.id} className={`sofia-chat-message is-${message.author}`}>
                {message.content}
              </p>
            ))}
            {loading && (
              <p className="sofia-chat-message is-sofia is-thinking">SofIA está pensando</p>
            )}
            {error && (
              <p className="sofia-chat-error" role="alert">
                {error}
              </p>
            )}
            <div ref={conversationEndRef} />
          </div>
          <form className="sofia-chat-form" onSubmit={(event) => void ask(event)}>
            <label className="sr-only" htmlFor="sofia-question">
              Pregunta a SofIA
            </label>
            <input
              ref={inputRef}
              id="sofia-question"
              value={question}
              maxLength={500}
              disabled={loading}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Escribe tu pregunta"
            />
            <button
              type="submit"
              disabled={loading || !question.trim()}
              aria-label="Enviar pregunta"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="m4 12 15-8-5 16-3-6-7-2Z" />
                <path d="m11 14 4-4" />
              </svg>
            </button>
          </form>
        </section>
      )}
      <button
        ref={triggerRef}
        type="button"
        className="sofia-chat-trigger"
        aria-expanded={open}
        aria-controls="sofia-chat-panel"
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className="sofia-chat-trigger-mark">
          <SofiaMark />
        </span>
        <span>SofIA</span>
      </button>
    </aside>
  );
}
