import { useState, useRef } from 'react';
import { MagnifyingGlass } from '@phosphor-icons/react';

export default function GlobalSearch() {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef(null);

  function open() {
    setExpanded(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function handleBlur() {
    if (!query) setExpanded(false);
  }

  return (
    <div
      className={`global-search-bar${expanded ? ' is-expanded' : ''}`}
      onClick={() => !expanded && open()}
    >
      <span className="global-search-bar-icon">
        <MagnifyingGlass size={20} weight="bold" aria-hidden="true" />
      </span>
      <input
        ref={inputRef}
        type="text"
        className="global-search-bar-input"
        placeholder="Search..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={open}
        onBlur={handleBlur}
      />
    </div>
  );
}
