import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Navbar from '../components/Navbar';
import GenreScrollBar from '../components/GenreScrollBar';
import LoadingBar from '../components/LoadingBar';
import { useAuth } from '../contexts/AuthContext';
import { maturityRestriction } from '../utils/kidsMode';
import { loadCollections, sharedFeed, visibleCollections } from '../utils/collections';
import { posterSrc } from '../utils/imageQuality';

// /collections: every ready-made set, grouped (Malayalam, Franchises,
// Holidays…), with chips to jump to one group. A card shows the set's first
// posters once it scrolls into view (that first page is kept, so opening the
// set shows it at once). The sets themselves are utils/collections.js.
export default function Collections() {
  const { activeProfile } = useAuth();
  const kidsSafe = maturityRestriction(activeProfile);
  const [searchParams, setSearchParams] = useSearchParams();
  const groupId = searchParams.get('group') || '';
  const [state, setState] = useState({ status: 'loading', groups: [] });

  useEffect(() => {
    let cancelled = false;
    loadCollections()
      .then((data) => { if (!cancelled) setState({ status: 'done', ...visibleCollections(data, { kidsSafe }) }); })
      .catch(() => { if (!cancelled) setState({ status: 'error', groups: [] }); });
    return () => { cancelled = true; };
  }, [kidsSafe]);

  const shown = groupId ? state.groups.filter((g) => g.id === groupId) : state.groups;
  const pick = (id) => setSearchParams(id ? { group: id } : {}, { replace: true });

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content coll-page">
        <header className="st-page-head">
          <div>
            <h1 className="st-page-title">Collections</h1>
            <p className="st-page-sub">Ready-made sets to scroll through. New releases join them on their own.</p>
          </div>
        </header>

        {state.status === 'loading' && <LoadingBar label="Loading collections…" />}
        {state.status === 'error' && (
          <div className="coll-empty">
            <p>Couldn't load the collections right now.</p>
            <button type="button" className="st-btn" onClick={() => window.location.reload()}>Try again</button>
          </div>
        )}
        {state.status === 'done' && (
          <>
            <GenreScrollBar ariaLabel="Show a group of collections">
              <button type="button" className={`genre-chip${!groupId ? ' active' : ''}`} aria-pressed={!groupId} onClick={() => pick('')}>All</button>
              {state.groups.map((group) => (
                <button key={group.id} type="button" className={`genre-chip${groupId === group.id ? ' active' : ''}`} aria-pressed={groupId === group.id} onClick={() => pick(group.id)}>
                  {group.title}
                </button>
              ))}
            </GenreScrollBar>
            {shown.map((group) => (
              <section key={group.id} className="coll-group" aria-labelledby={`coll-${group.id}`}>
                <h2 id={`coll-${group.id}`} className="st-row-title">{group.title}</h2>
                <div className="coll-grid">
                  {group.collections.map((collection) => <CollectionCard key={collection.id} collection={collection} kidsSafe={kidsSafe} />)}
                </div>
              </section>
            ))}
          </>
        )}
      </main>
    </div>
  );
}

function CollectionCard({ collection, kidsSafe }) {
  const ref = useRef(null);
  const [posters, setPosters] = useState(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    let cancelled = false;
    const feed = sharedFeed(collection, { kidsSafe });
    const show = (items) => { if (!cancelled) setPosters(items.slice(0, 3).map((item) => item.poster_url).filter(Boolean)); };
    if (feed.items().length) { show(feed.items()); return undefined; }
    const load = () => feed.more().then(show).catch(() => show([]));
    if (typeof IntersectionObserver === 'undefined') { load(); return () => { cancelled = true; }; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { observer.disconnect(); load(); }
    }, { rootMargin: '300px' });
    observer.observe(node);
    return () => { cancelled = true; observer.disconnect(); };
  }, [collection, kidsSafe]);

  return (
    <Link ref={ref} to={`/collections/${collection.id}`} className="coll-card">
      <span className="coll-art" aria-hidden="true">
        {(posters || [null, null, null]).slice(0, 3).map((poster, index) => (
          poster
            ? <img key={poster} src={posterSrc(poster)} alt="" loading="lazy" className={`coll-poster coll-poster--${index}`} />
            : <span key={`empty-${index}`} className={`coll-poster coll-poster--${index} coll-poster--empty`} />
        ))}
      </span>
      <span className="coll-text">
        <span className="coll-title">{collection.title}</span>
        <span className="coll-sub">{collection.subtitle}</span>
      </span>
    </Link>
  );
}
