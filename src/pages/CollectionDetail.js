import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CaretLeft } from '@phosphor-icons/react';
import Navbar from '../components/Navbar';
import TitleCard from '../components/TitleCard';
import LoadingBar from '../components/LoadingBar';
import { useAuth } from '../contexts/AuthContext';
import { maturityRestriction } from '../utils/kidsMode';
import { loadCollections, sharedFeed, visibleCollections } from '../utils/collections';

// /collections/:id: one set as a grid that keeps loading as you scroll.
export default function CollectionDetail() {
  const { id } = useParams();
  const { activeProfile } = useAuth();
  const kidsSafe = maturityRestriction(activeProfile);
  const [collection, setCollection] = useState(undefined); // undefined: loading, null: no such set
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | more | idle | done | error
  const feedRef = useRef(null);
  const sentinelRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setCollection(undefined);
    setItems([]);
    setStatus('loading');
    loadCollections()
      .then((data) => {
        if (cancelled) return;
        const found = visibleCollections(data, { kidsSafe }).collections.find((c) => c.id === id) || null;
        setCollection(found);
        if (!found) return;
        feedRef.current = sharedFeed(found, { kidsSafe });
        const kept = feedRef.current.items();
        if (kept.length) { setItems(kept); setStatus(feedRef.current.done() ? 'done' : 'idle'); return; }
        feedRef.current.more()
          .then((all) => { if (!cancelled) { setItems(all); setStatus(feedRef.current.done() ? 'done' : 'idle'); } })
          .catch(() => { if (!cancelled) setStatus('error'); });
      })
      .catch(() => { if (!cancelled) { setCollection(null); setStatus('error'); } });
    return () => { cancelled = true; };
  }, [id, kidsSafe]);

  const loadMore = useCallback(() => {
    const feed = feedRef.current;
    if (!feed || feed.done()) return;
    setStatus('more');
    feed.more()
      .then((all) => { setItems(all); setStatus(feed.done() ? 'done' : 'idle'); })
      .catch(() => setStatus('error'));
  }, []);

  // The next batch loads as the end of the grid comes near.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || status !== 'idle' || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore();
    }, { rootMargin: '800px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [status, loadMore, items.length]);

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content coll-page">
        <Link to="/collections" className="coll-back"><CaretLeft size={16} weight="bold" aria-hidden="true" /> All collections</Link>
        {collection === null && status !== 'error' && (
          <div className="coll-empty"><p>That collection doesn't exist any more.</p><Link className="st-btn" to="/collections">See all collections</Link></div>
        )}
        {collection && (
          <header className="st-page-head">
            <div>
              <h1 className="st-page-title">{collection.title}</h1>
              <p className="st-page-sub">
                {collection.subtitle}
                {items.length > 0 && ` · ${items.length}${status === 'done' ? '' : '+'} on binge.`}
              </p>
            </div>
          </header>
        )}
        {status === 'loading' && collection !== null && <LoadingBar label="Loading this collection…" />}
        {items.length > 0 && (
          <div className="st-grid">
            {items.map((item, index) => (
              <div className="st-grid-cell" key={`${item.media_type}:${item.id}`}>
                <TitleCard item={item} priority={index < 6} showMatch={false} />
              </div>
            ))}
          </div>
        )}
        {status === 'done' && items.length === 0 && (
          <div className="coll-empty"><p>Nothing in this collection is on binge. for this profile yet. New titles join it as they come out.</p></div>
        )}
        {status === 'error' && (
          <div className="coll-empty">
            <p>Couldn't load {items.length ? 'more of ' : ''}this collection.</p>
            <button type="button" className="st-btn" onClick={loadMore}>Try again</button>
          </div>
        )}
        {status === 'more' && <LoadingBar label="Loading more…" compact />}
        <div ref={sentinelRef} aria-hidden="true" />
        {status === 'idle' && (
          <div className="coll-more"><button type="button" className="st-btn td-resume-control td-play--compact" onClick={loadMore}>Show more</button></div>
        )}
      </main>
    </div>
  );
}
