import SlidingTabs from './SlidingTabs';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { MagnifyingGlass, X } from '@phosphor-icons/react';
import { DEFAULT_PROVIDER, PROVIDER_LIST, getProvider } from '../utils/mangaProviders';
import BrowseHero from './BrowseHero';
import TitleRow from './TitleRow';
import { MangaReader } from './manga/MangaReader';
import { ChapterModal } from './manga/ChapterModal';
import { MangaRowCard } from './manga/MangaRowCard';
import { getMangaList } from '../utils/mangaLibrary';

function asHeroItem(manga, onOpen) {
  return {
    id: manga.id,
    media_type: 'manga',
    title: manga.title,
    cover_url: manga.cover,
    overview: manga.description,
    genre: (manga.tags || []).join(', '),
    year: manga.year,
    author: manga.author,
    _playLabel: 'Read',
    _onOpen: () => onOpen(manga),
  };
}

// ─── MangaTab ─────────────────────────────────────────────────
export default function MangaTab() {
  const [query, setQuery]           = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [results, setResults]       = useState([]);
  const [popular, setPopular]       = useState(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [providerKey, setProviderKey] = useState(() => {
    try { return getProvider(window.localStorage.getItem('binge:manga-provider')).key; } catch { return DEFAULT_PROVIDER; }
  });
  const provider = getProvider(providerKey);
  const [selected, setSelected]     = useState(null);
  const [reader, setReader]         = useState(null);
  const abortRef = useRef(null);

  function chooseProvider(key) {
    setProviderKey(key);
    setPopular(null);
    try { window.localStorage.setItem('binge:manga-provider', key); } catch { /* private mode */ }
  }

  useEffect(() => {
    const ctrl = new AbortController();
    provider.popular(ctrl.signal)
      .then((items) => setPopular(items || []))
      .catch((e) => { if (e.name !== 'AbortError') setPopular([]); });
    return () => ctrl.abort();
  }, [provider]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!debouncedQ) { setResults([]); setError(''); return undefined; }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError('');
    provider.search(debouncedQ, ctrl.signal)
      .then((list) => setResults(Array.isArray(list) ? list : []))
      .catch(e => { if (e.name !== 'AbortError') setError(e.message || 'Search failed — try again.'); })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [debouncedQ, provider]);

  const openReader = useCallback((ch, chapters) => {
    const idx = chapters.findIndex(c => c.id === ch.id);
    setReader({ comic: selected, chapters, index: Math.max(0, idx) });
    setSelected(null);
  }, [selected]);

  const continueReading = useMemo(() => {
    const list = getMangaList();
    return Object.values(list)
      .filter((entry) => entry && (entry.status === 'reading' || entry.status === 'plan_to_read'))
      .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))
      .map((entry) => ({ ...entry, _progressLabel: entry.status === 'reading' ? 'Reading' : null }));
  // Reads localStorage; recomputed when the reader closes or the selection changes (both save progress).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reader, selected]);

  const loaders = useMemo(() => {
    const map = new Map();
    provider.rows.forEach((row) => map.set(row.id, () => row.load()));
    return map;
  }, [provider]);

  if (reader) {
    return (
      <MangaReader
        comic={reader.comic}
        chapters={reader.chapters}
        index={reader.index}
        onPrev={() => setReader(r => ({ ...r, index: r.index - 1 }))}
        onNext={() => setReader(r => ({ ...r, index: r.index + 1 }))}
        onClose={() => setReader(null)}
      />
    );
  }

  const isSearching = Boolean(debouncedQ);
  const renderCard = (rank) => (manga, index) => (
    <MangaRowCard manga={manga} onOpen={setSelected} rank={rank ? index + 1 : null} priority={index < 6} />
  );

  return (
    <div className="st-browse st-manga">
      {!isSearching && (
        <BrowseHero
          items={popular == null ? null : popular.filter((m) => m.cover).sort((a, b) => Number(Boolean(b.description)) - Number(Boolean(a.description))).slice(0, 6).map((m) => asHeroItem(m, setSelected))}
          kicker={`Popular on ${provider.label}`}
          emptyTitle="Manga, manhwa & comics"
          playLabel="Read"
        />
      )}

      <SlidingTabs className="st-tabs st-tabs--sm manga-providers" role="group" aria-label="Source">
        {PROVIDER_LIST.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className={`st-tab${entry.key === provider.key ? ' active' : ''}`}
            aria-pressed={entry.key === provider.key}
            onClick={() => chooseProvider(entry.key)}
          >
            {entry.label}
          </button>
        ))}
      </SlidingTabs>
      <p className="manga-provider-note">{provider.tagline}</p>

      <div className="catalog-search-row st-manga-search">
        <div className="catalog-search-bar">
          <MagnifyingGlass size={18} weight="bold" className="catalog-search-icon" aria-hidden="true" />
          <input
            type="text"
            className="catalog-search-input"
            placeholder={`Search ${provider.label}…`}
            value={query}
            onChange={e => setQuery(e.target.value)}
            aria-label="Search manga"
          />
          {query && (
            <button type="button" className="catalog-search-clear" onClick={() => setQuery('')} aria-label="Clear search">
              <X size={14} weight="bold" />
            </button>
          )}
        </div>
      </div>

      {error && <div className="st-coldstart"><p>{error}</p></div>}

      {isSearching ? (
        <section className="st-search-section" aria-label="Search results">
          <h2 className="st-row-title">{loading ? 'Searching…' : `Results for “${debouncedQ}”`}</h2>
          {!loading && results.length === 0 && !error && (
            <div className="pf-empty"><p>No results for “{debouncedQ}”.</p><p className="td-muted">Try the English or original title.</p></div>
          )}
          <div className="st-grid">
            {(loading ? [] : results).map((manga, index) => (
              <div className="st-grid-cell" key={manga.id || index}>
                <MangaRowCard manga={manga} onOpen={setSelected} priority={index < 6} />
              </div>
            ))}
          </div>
        </section>
      ) : (
        <div className="st-rows">
          {continueReading.length > 0 && (
            <TitleRow title="Continue Reading" items={continueReading} renderItem={renderCard(false)} />
          )}
          {provider.rows.map((row) => (
            <TitleRow
              key={`${provider.key}-${row.id}`}
              title={row.title}
              subtitle={row.subtitle}
              ranked={row.ranked}
              load={loaders.get(row.id)}
              renderItem={renderCard(row.ranked)}
              minItems={4}
            />
          ))}
        </div>
      )}

      {selected && (
        <ChapterModal
          comic={selected}
          onClose={() => setSelected(null)}
          onRead={openReader}
        />
      )}
    </div>
  );
}
