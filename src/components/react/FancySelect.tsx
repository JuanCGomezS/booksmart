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
  menuClassName?: string;
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
  menuClassName = '',
}: FancySelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listId = useMemo(() => `fancy-select-${Math.random().toString(36).slice(2, 10)}`, []);

  const selected = options.find((item) => item.value === value);
  const firstEnabledIndex = options.findIndex((item) => !item.disabled);
  const lastEnabledIndex = options.map((item) => !item.disabled).lastIndexOf(true);
  const selectedEnabledIndex = options.findIndex((item) => item.value === value && !item.disabled);

  const focusOption = (index: number) => {
    setActiveIndex(index);
    requestAnimationFrame(() => optionRefs.current[index]?.focus());
  };

  const getNextEnabledIndex = (currentIndex: number, direction: 1 | -1) => {
    if (firstEnabledIndex === -1) return -1;

    let index = currentIndex;
    for (let attempts = 0; attempts < options.length; attempts += 1) {
      index = (index + direction + options.length) % options.length;
      if (!options[index].disabled) return index;
    }

    return currentIndex;
  };

  const selectOption = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;

    onChange(option.value);
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const openMenu = (
    preferredIndex = selectedEnabledIndex >= 0 ? selectedEnabledIndex : firstEnabledIndex,
  ) => {
    const nextPosition = getMenuPosition();
    if (!nextPosition) return;

    setPosition(nextPosition);
    setOpen(true);
    if (preferredIndex >= 0) focusOption(preferredIndex);
  };

  const getMenuPosition = (): MenuPosition | null => {
    const trigger = triggerRef.current;
    if (!trigger) return null;

    const rect = trigger.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const estimatedHeight = options.length * 42 + 12;
    const spaceBelow = viewportHeight - rect.bottom;
    const spaceAbove = rect.top;

    const placeAbove = spaceBelow < estimatedHeight && spaceAbove > spaceBelow;
    const top = placeAbove ? rect.top - estimatedHeight - 4 : rect.bottom + 4;

    return {
      top: Math.max(8, top),
      left: rect.left,
      width: rect.width,
    };
  };

  useEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const nextPosition = getMenuPosition();
      if (nextPosition) setPosition(nextPosition);
    };

    const closeOnOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    document.addEventListener('mousedown', closeOnOutside);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      document.removeEventListener('mousedown', closeOnOutside);
    };
  }, [open, options.length]);

  const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        openMenu(
          event.key === 'ArrowDown'
            ? selectedEnabledIndex >= 0
              ? selectedEnabledIndex
              : firstEnabledIndex
            : selectedEnabledIndex >= 0
              ? selectedEnabledIndex
              : lastEnabledIndex,
        );
      } else {
        const nextIndex = getNextEnabledIndex(
          activeIndex >= 0 ? activeIndex : firstEnabledIndex,
          event.key === 'ArrowDown' ? 1 : -1,
        );
        if (nextIndex >= 0) focusOption(nextIndex);
      }
      return;
    }

    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const candidates = event.key === 'Home' ? options : [...options].reverse();
      const offset = candidates.findIndex((item) => !item.disabled);
      const nextIndex = event.key === 'Home' ? offset : options.length - offset - 1;
      if (!open) openMenu(nextIndex);
      else if (nextIndex >= 0) focusOption(nextIndex);
      return;
    }

    if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
    }
  };

  const handleOptionKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const nextIndex = getNextEnabledIndex(index, event.key === 'ArrowDown' ? 1 : -1);
      if (nextIndex >= 0) focusOption(nextIndex);
      return;
    }

    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const candidates = event.key === 'Home' ? options : [...options].reverse();
      const offset = candidates.findIndex((item) => !item.disabled);
      const nextIndex = event.key === 'Home' ? offset : options.length - offset - 1;
      if (nextIndex >= 0) focusOption(nextIndex);
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectOption(index);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

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
        onKeyDown={handleTriggerKeyDown}
        onClick={() => {
          if (disabled) return;

          if (open) {
            setOpen(false);
            return;
          }

          openMenu();
        }}
      >
        <span className={selected ? 'text-main' : 'text-subtle'}>
          {selected?.label ?? placeholder}
        </span>
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className={`h-4 w-4 shrink-0 text-subtle transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path
            d="M7 10l5 5 5-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open &&
        position &&
        createPortal(
          <div
            ref={menuRef}
            id={listId}
            role="listbox"
            aria-activedescendant={activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined}
            className={['surface-card rounded-xl p-1', menuClassName].join(' ')}
            style={{
              position: 'fixed',
              top: `${position.top}px`,
              left: `${position.left}px`,
              width: `${position.width}px`,
              zIndex: 9999,
            }}
          >
            {options.map((item, index) => {
              const isSelected = item.value === value;
              return (
                <button
                  ref={(element) => {
                    optionRefs.current[index] = element;
                  }}
                  key={item.value}
                  id={`${listId}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={item.disabled}
                  tabIndex={item.disabled ? -1 : activeIndex === index ? 0 : -1}
                  className={[
                    'block w-full rounded-lg px-3 py-2 text-left text-sm transition-colors',
                    isSelected
                      ? 'bg-[color-mix(in_srgb,var(--secondary)_22%,var(--surface))] text-main'
                      : 'text-subtle hover:bg-[color-mix(in_srgb,var(--secondary)_12%,transparent)] hover:text-main',
                    item.disabled ? 'cursor-not-allowed opacity-50' : '',
                  ].join(' ')}
                  onFocus={() => setActiveIndex(index)}
                  onKeyDown={(event) => handleOptionKeyDown(event, index)}
                  onClick={() => selectOption(index)}
                >
                  {item.label}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
