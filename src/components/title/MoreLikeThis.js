import LoadingBar from '../LoadingBar';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { fetchTmdbRecommendations } from '../../utils/tmdb';
import { resolveTmdbItems } from '../../utils/catalogLookup';
import { useWatchedKeys, withoutWatched } from '../../utils/watchedTitles';
import { maturityRestriction } from '../../utils/kidsMode';
import { useAuth } from '../../contexts/AuthContext';
import { backdropSrc, posterSrc } from '../../utils/imageQuality';
import { titleUrl } from '../TitleCard';
import { formatReleaseDay } from '../../utils/releaseWindow';
import { splitList } from './format';

// TMDB's recommendations for this title within the profile's maturity
// level, minus what the profile has watched.
export function MoreLikeThis({ mediaType, tmdbId }) {
  const location = useLocation();
  const kidsSafe = maturityRestriction(useAuth()?.activeProfile);
  const [loaded, setItems] = useState(null);
  const watched = useWatchedKeys();
  const items = useMemo(() => (loaded && watched ? withoutWatched(loaded, watched).slice(0, 12) : null), [loaded, watched]);

  useEffect(() => {
    setItems(null);
    if (!tmdbId) return undefined;
    let cancelled = false;
    fetchTmdbRecommendations(mediaType, tmdbId)
      .then((list) => resolveTmdbItems(list || [], mediaType, { kidsSafe }))
      .then((resolved) => { if (!cancelled) setItems(resolved.slice(0, 30)); })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, [mediaType, tmdbId, kidsSafe]);

  if (items && items.length === 0) return null;
  const background = location.state?.backgroundLocation || location;

  return (
    <section className="td-section" aria-label="More like this">
      <div className="td-section-head"><h3>More Like This</h3></div>
      <div className="td-more-grid">
        {!items && <div style={{ gridColumn: '1 / -1' }}><LoadingBar compact label="Loading similar titles…" /></div>}
        {items?.map((entry) => (
          <Link
            key={entry.id}
            to={titleUrl(entry)}
            state={{ backgroundLocation: background }}
            replace={Boolean(location.state?.backgroundLocation)}
            className="td-more-card"
          >
            <span className="td-more-art">
              <img
                src={backdropSrc(entry.backdrop_url, 'w780') || posterSrc(entry.poster_url)}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
              />
              {entry._comingSoon && <span className="st-badge st-badge--soon">Coming {formatReleaseDay(entry)}</span>}
            </span>
            <span className="td-more-body">
              <span className="td-more-title">{entry.title}</span>
              <span className="td-muted">
                {[entry.year || String(entry.release_date || '').slice(0, 4), splitList(entry.genre)[0]].filter(Boolean).join(' · ')}
              </span>
              {entry.overview && <span className="td-more-overview">{entry.overview}</span>}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
