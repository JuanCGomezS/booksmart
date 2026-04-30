import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface FancySelectOption<T extends string = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

interface FancySelectProps<T extends string = string> {
  value: T;
  options: FancySelectOption<T>[];
  onChange: (nextValue: T) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  buttonClassName?: string;
}

type MenuPosition = {
  top: number;
  left: number;
  width: number;
};

export default function FancySelect<T extends string = string>({
  value,
  options,
  onChange,
  disabled = false,
  placeholder = 'Selecciona una opción',
  className = '',
  buttonClassName = '',
}: FancySelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition>({ top: 0, left: 0, width: 0 });

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const listId = useMemo(() => `fancy-select-${Math.random().toString(36).slice(2, 10)}`, []);

  const selected = options.find((item) => item.value === value);

  useEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;

      const rect = trigger.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const estimatedHeight = options.length * 42 + 12;
      const spaceBelow = viewportHeight - rect.bottom;
      const spaceAbove = rect.top;

      const placeAbove = spaceBelow < estimatedHeight && spaceAbove > spaceBelow;
      const top = placeAbove ? rect.top - estimatedHeight - 4 : rect.bottom + 4;

      setPosition({
        top: Math.max(8, top),
        left: rect.left,
        width: rect.width,
      });
    };

    const closeOnOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    document.addEventListener('mousedown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      document.removeEventListener('mousedown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open, options.length]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={[
          'field-input flex min-h-[2.7rem] w-full items-center justify-between gap-2 text-left',
          buttonClassName,
          className,
        ].join(' ')}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listId}
        disabled={disabled}
        onClick={() => {
          if (!disabled) setOpen((prev) => !prev);
        }}
      >
        <span className={selected ? 'text-main' : 'text-subtle'}>{selected?.label ?? placeholder}</span>
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className={`h-4 w-4 shrink-0 text-subtle transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          id={listId}
          role="listbox"
          className="surface-card rounded-xl p-1"
          style={{
            position: 'fixed',
            top: `${position.top}px`,
            left: `${position.left}px`,
            width: `${position.width}px`,
            zIndex: 9999,
          }}
        >
          {options.map((item) => {
            const isSelected = item.value === value;
            return (
              <button
                key={item.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={item.disabled}
                className={[
                  'block w-full rounded-lg px-3 py-2 text-left text-sm transition-colors',
                  isSelected
                    ? 'bg-[color-mix(in_srgb,var(--secondary)_22%,var(--surface))] text-main'
                    : 'text-subtle hover:bg-[color-mix(in_srgb,var(--secondary)_12%,transparent)] hover:text-main',
                  item.disabled ? 'cursor-not-allowed opacity-50' : '',
                ].join(' ')}
                onClick={() => {
                  if (item.disabled) return;
                  onChange(item.value);
                  setOpen(false);
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
}
