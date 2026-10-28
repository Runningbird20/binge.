import { useId, useRef, useState } from 'react';
import { MagnifyingGlass, X } from '@phosphor-icons/react';

export default function ExpandableSearch({ value, onChange, label }) {
  const [open, setOpen] = useState(Boolean(value));
  const inputRef = useRef(null);
  const toggleRef = useRef(null);
  const inputId = useId();

  function collapse() {
    onChange('');
    setOpen(false);
    toggleRef.current?.focus();
  }

  return (
    <div className={`expandable-search${open ? ' is-open' : ''}`} onKeyDown={(event) => {
      if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); collapse(); }
    }}>
      <button
        ref={toggleRef}
        type="button"
        className="expandable-search-toggle"
        aria-label={open ? `Collapse ${label.toLowerCase()}` : label}
        aria-expanded={open}
        aria-controls={inputId}
        onClick={() => {
          if (open) collapse();
          else { setOpen(true); requestAnimationFrame(() => inputRef.current?.focus()); }
        }}
      >
        <MagnifyingGlass size={22} weight="bold" aria-hidden="true" />
      </button>
      <input
        ref={inputRef}
        id={inputId}
        type="search"
        aria-label={label}
        placeholder={`${label}…`}
        value={value}
        disabled={!open}
        tabIndex={open ? 0 : -1}
        onChange={(event) => onChange(event.target.value)}
      />
      {open && <button type="button" className="expandable-search-close" aria-label="Close search" onClick={collapse}><X size={18} weight="bold" aria-hidden="true" /></button>}
    </div>
  );
}
