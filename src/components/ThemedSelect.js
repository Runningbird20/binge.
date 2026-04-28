import { useEffect, useMemo, useRef, useState } from 'react';

function normalizeOptions(options = []) {
  if (options.length) {
    return options.map((option) => (
      typeof option === 'object'
        ? option
        : { value: option, label: option }
    ));
  }

  return [];
}

export default function ThemedSelect({
  value,
  onChange,
  options = [],
  className = '',
  label = '',
  'aria-label': ariaLabel,
  disabled = false,
  onClick,
  style,
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef(null);
  const normalizedOptions = useMemo(() => normalizeOptions(options), [options]);
  const selectedIndex = Math.max(0, normalizedOptions.findIndex((option) => String(option.value) === String(value)));
  const selectedOption = normalizedOptions[selectedIndex] || normalizedOptions[0] || { label: '' };
  const controlLabel = ariaLabel || label || 'Select option';

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(event) {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      setActiveIndex(selectedIndex);
    }
  }, [open, selectedIndex]);

  function emitChange(nextValue) {
    onChange?.({ target: { value: nextValue } });
  }

  function selectOption(option) {
    if (!option || option.disabled) return;
    emitChange(option.value);
    setOpen(false);
  }

  function handleKeyDown(event) {
    if (disabled) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }

      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((current) => {
        let next = current;
        for (let i = 0; i < normalizedOptions.length; i += 1) {
          next = (next + direction + normalizedOptions.length) % normalizedOptions.length;
          if (!normalizedOptions[next]?.disabled) return next;
        }
        return current;
      });
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (open) {
        selectOption(normalizedOptions[activeIndex]);
      } else {
        setOpen(true);
      }
      return;
    }

    if (event.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div
      ref={rootRef}
      className={`themed-select${open ? ' themed-select--open' : ''}${disabled ? ' themed-select--disabled' : ''}${className ? ` ${className}` : ''}`}
      style={style}
      onClick={onClick}
    >
      {label && <span className="themed-select-label">{label}</span>}
      <button
        type="button"
        className="themed-select-control"
        aria-label={controlLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => !disabled && setOpen((current) => !current)}
        onKeyDown={handleKeyDown}
      >
        <span className="themed-select-value">{selectedOption.label}</span>
        <span className="themed-select-chevron" aria-hidden="true" />
      </button>
      {open && (
        <div className="themed-select-menu" role="listbox" aria-label={controlLabel}>
          {normalizedOptions.map((option, index) => {
            const selected = String(option.value) === String(value);
            const active = index === activeIndex;
            return (
              <button
                type="button"
                key={`${option.value}-${index}`}
                role="option"
                aria-selected={selected}
                className={`themed-select-option${selected ? ' selected' : ''}${active ? ' active' : ''}`}
                disabled={option.disabled}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectOption(option)}
              >
                {option.icon && <span className="themed-select-option-icon">{option.icon}</span>}
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
