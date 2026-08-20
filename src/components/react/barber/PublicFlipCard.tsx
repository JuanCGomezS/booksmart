import React, { useEffect, useRef, useState } from 'react';

type FlipCardControls = { flipped: boolean; open: () => void; close: () => void };
type ActiveFlipCard = { id: symbol; deactivate: () => boolean };

// A public page can render several cards at once, but Escape and focus recovery
// must have exactly one owner across them.
let activeFlipCard: ActiveFlipCard | null = null;

type PublicFlipCardProps = {
  title: string;
  className?: string;
  hoverFlip?: boolean;
  wholeCard?: boolean;
  front: (controls: FlipCardControls) => React.ReactNode;
  back: (controls: FlipCardControls) => React.ReactNode;
};

/** Shared, accessible flip interaction for public catalog and product content. */
export default function PublicFlipCard({
  title,
  className = '',
  hoverFlip = true,
  wholeCard = true,
  front,
  back,
}: PublicFlipCardProps) {
  const [flipped, setFlipped] = useState(false);
  const [focusFace, setFocusFace] = useState<'front' | 'back' | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const frontRef = useRef<HTMLElement>(null);
  const backRef = useRef<HTMLElement>(null);
  const cardId = useRef(Symbol('public-flip-card'));
  const releaseActiveCard = () => {
    if (activeFlipCard?.id === cardId.current) activeFlipCard = null;
  };
  const deactivateFromAnotherCard = () => {
    const hadFocus = cardRef.current?.contains(document.activeElement) ?? false;
    releaseActiveCard();
    setFocusFace(null);
    setFlipped(false);
    return hadFocus;
  };
  const claimActiveCard = () => {
    if (activeFlipCard?.id === cardId.current) return false;
    const shouldMoveFocus = activeFlipCard?.deactivate() ?? false;
    activeFlipCard = { id: cardId.current, deactivate: deactivateFromAnotherCard };
    return shouldMoveFocus;
  };
  const controls = {
    flipped,
    open: () => {
      claimActiveCard();
      setFocusFace('back');
      setFlipped(true);
    },
    close: () => {
      releaseActiveCard();
      setFocusFace('front');
      setFlipped(false);
    },
  };
  const openFromHover = () => {
    // A mouse can enter after a keyboard user has focused the front action.
    // Move that focus before making the front inert; otherwise focus could
    // remain on content that is no longer operable.
    const shouldMoveFocus = claimActiveCard();
    if (frontRef.current?.contains(document.activeElement) || shouldMoveFocus) setFocusFace('back');
    setFlipped(true);
  };
  const isNestedInteractiveTarget = (target: EventTarget | null) =>
    target instanceof Element &&
    Boolean(target.closest('a, button, input, select, textarea, summary, [data-flip-card-exempt]'));
  const closeFromCard = (event: React.MouseEvent<HTMLElement>) => {
    if (wholeCard && !isNestedInteractiveTarget(event.target)) controls.close();
  };

  useEffect(() => {
    // React's JSX typings do not yet consistently include `inert`; set the
    // native property after each flip so hidden controls cannot retain focus.
    frontRef.current?.toggleAttribute('inert', flipped);
    backRef.current?.toggleAttribute('inert', !flipped);
  }, [flipped]);

  useEffect(() => {
    if (!focusFace) return;
    const selector = focusFace === 'back' ? '[data-flip-back-focus]' : '[data-flip-trigger]';
    const frame = window.requestAnimationFrame(() => {
      cardRef.current?.querySelector<HTMLElement>(selector)?.focus();
      setFocusFace(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [flipped, focusFace]);

  useEffect(() => {
    if (!flipped) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || activeFlipCard?.id !== cardId.current) return;
      releaseActiveCard();
      setFocusFace('front');
      setFlipped(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [flipped]);

  useEffect(() => () => releaseActiveCard(), []);

  return (
    <div
      ref={cardRef}
      className={`public-business-flip-card ${className} ${flipped ? 'is-flipped' : ''}`}
      onPointerEnter={(event) => {
        if (hoverFlip && event.pointerType === 'mouse') openFromHover();
      }}
      onPointerLeave={(event) => {
        if (
          hoverFlip &&
          event.pointerType === 'mouse' &&
          !cardRef.current?.contains(document.activeElement)
        ) {
          releaseActiveCard();
          setFlipped(false);
        }
      }}
    >
      <div className="public-business-flip-card-inner">
        <article
          ref={frontRef}
          className="public-business-flip-card-face public-business-flip-card-front"
          aria-hidden={flipped}
        >
          {front(controls)}
          {wholeCard && (
            <button
              data-flip-trigger
              type="button"
              className="public-business-flip-card-face-trigger"
              aria-label={`Mostrar detalles de ${title}`}
              aria-expanded={false}
              onClick={controls.open}
            />
          )}
        </article>
        <article
          ref={backRef}
          className="public-business-flip-card-face public-business-flip-card-back"
          aria-hidden={!flipped}
          aria-label={`Descripción de ${title}`}
          onClick={closeFromCard}
        >
          {wholeCard && (
            <button
              data-flip-back-focus
              type="button"
              className="public-business-flip-card-face-trigger"
              aria-label={`Cerrar detalles de ${title}`}
              aria-expanded
              onClick={controls.close}
            />
          )}
          {back(controls)}
        </article>
      </div>
    </div>
  );
}
