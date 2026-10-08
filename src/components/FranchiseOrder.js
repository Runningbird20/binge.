import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CheckCircle, Play } from '@phosphor-icons/react';
import { findFranchise } from '../utils/franchises';
import { resolveTmdbItems } from '../utils/catalogLookup';
import { fetchSupabaseRatingMap, fetchSupabaseWatchlistStatusMap, fetchSupabaseContinueWatching } from '../utils/supabaseData';
import { posterSrc } from '../utils/imageQuality';
import { titleUrl } from './TitleCard';
import HScroll from './HScroll';

// "Part of the Marvel Cinematic Universe · 12 of 37 watched": the
// franchise in release or story order, your progress through it, and
// what to watch next.
export default function FranchiseOrder({ tmdbId, currentId }) {
  const location = useLocation();
  const [franchise, setFranchise] = useState(null);
  const [items, setItems] = useState(null); // catalog rows by tmdb id
  const [watched, setWatched] = useState(new Set());
  const [started, setStarted] = useState(new Set());
  const [order, setOrder] = useState('story');
  const listRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setFranchise(null);
    setItems(null);
    if (!tmdbId) return undefined;
    findFranchise(tmdbId).then(async (found) => {
      if (cancelled || !found) return;
      setFranchise(found);
      if (!found.story) setOrder('release');
      const resolved = await resolveTmdbItems(found.release, 'movie').catch(() => []);
      if (!cancelled) setItems(new Map(resolved.map((item) => [item._tmdb?.tmdbId, item])));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [tmdbId]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchSupabaseRatingMap('movie').catch(() => ({})),
      fetchSupabaseWatchlistStatusMap('movie').catch(() => ({})),
      fetchSupabaseContinueWatching().catch(() => []),
    ]).then(([ratings, statuses, playing]) => {
      if (cancelled) return;
      const done = new Set(Object.keys(ratings || {}).map(Number));
      Object.entries(statuses || {}).forEach(([id, entry]) => { if (entry?.status === 'watched') done.add(Number(id)); });
      setWatched(done);
      setStarted(new Set((playing || []).filter((row) => row.media_type === 'movie').map((row) => Number(row.media_id))));
    });
    return () => { cancelled = true; };
  }, [tmdbId]);

  const list = useMemo(() => {
    if (!franchise) return [];
    return (order === 'story' && franchise.story ? franchise.story : franchise.release).map((result, index) => ({
      result,
      index,
      item: items?.get(result.tmdbId) || null,
    }));
  }, [franchise, items, order]);

  // Keep the title you're looking at in view when the order changes.
  useEffect(() => {
    const list = listRef.current;
    const current = list?.querySelector('li.current');
    if (list && current) list.scrollLeft = current.offsetLeft - list.clientWidth / 2 + current.clientWidth / 2;
  }, [list, items]);

  if (!franchise || !items) return null;
  const available = list.filter((entry) => entry.item);
  const watchedCount = available.filter((entry) => watched.has(entry.item.id)).length;
  const next = available.find((entry) => !watched.has(entry.item.id) && entry.item.id !== currentId)
    || null;
  const background = location.state?.backgroundLocation || location;

  return (
    <section className="td-section fr" aria-label={`${franchise.name} watch order`}>
      <div className="td-section-head">
        <div>
          <h3>{franchise.name}</h3>
          <p className="td-muted fr-progress">
            {watchedCount} of {available.length} watched
            <span className="fr-bar" aria-hidden="true"><span style={{ width: `${available.length ? (watchedCount / available.length) * 100 : 0}%` }} /></span>
          </p>
        </div>
        {franchise.story && (
          <div className="hm-source" role="radiogroup" aria-label="Order">
            {[['story', 'Story order'], ['release', 'Release order']].map(([value, label]) => (
              <button key={value} type="button" role="radio" aria-checked={order === value} className={order === value ? 'active' : ''} onClick={() => setOrder(value)}>{label}</button>
            ))}
          </div>
        )}
      </div>

      {next && (
        <Link className="fr-next" to={titleUrl(next.item, { play: true })} state={{ backgroundLocation: background }}>
          <Play size={16} weight="fill" aria-hidden="true" />
          <span>Up next in {order === 'story' ? 'story' : 'release'} order: <strong>{next.result.title}</strong></span>
        </Link>
      )}

      <HScroll as="ol" className="fr-list" label={franchise.name} deps={list} scrollRef={listRef}>
        {list.map(({ result, index, item }) => {
          const isWatched = item && watched.has(item.id);
          const isCurrent = item && item.id === currentId;
          const content = (
            <>
              <span className="fr-num">{index + 1}</span>
              <span className="fr-poster">
                {result.posterPath ? <img src={posterSrc(`https://image.tmdb.org/t/p/w342${result.posterPath}`)} alt="" loading="lazy" /> : null}
                {isWatched && <CheckCircle className="fr-check" size={22} weight="fill" aria-label="watched" />}
                {!isWatched && item && started.has(item.id) && <span className="fr-started">In progress</span>}
              </span>
              <span className="fr-title">{result.title}</span>
              <span className="td-muted fr-year">{String(result.releaseDate || '').slice(0, 4)}{!item ? ' · not on binge.' : ''}</span>
            </>
          );
          return (
            <li key={result.tmdbId} className={`${isCurrent ? 'current' : ''}${isWatched ? ' watched' : ''}${!item ? ' missing' : ''}`}>
              {item && !isCurrent
                ? <Link to={titleUrl(item)} state={{ backgroundLocation: background }} replace className="fr-item">{content}</Link>
                : <span className="fr-item" aria-current={isCurrent ? 'true' : undefined}>{content}</span>}
            </li>
          );
        })}
      </HScroll>
    </section>
  );
}
