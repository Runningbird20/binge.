import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { FilmStrip } from '@phosphor-icons/react';
import { titleUrl } from '../TitleCard';
import { findAdaptations } from '../../utils/adaptations';
import { backdropSrc, posterSrc } from '../../utils/imageQuality';
import { maturityRestriction } from '../../utils/kidsMode';
import { useAuth } from '../../contexts/AuthContext';

// "Watch the adaptation" — movies/shows credited to this book's author.
export function Adaptations({ book }) {
  const location = useLocation();
  const kidsSafe = maturityRestriction(useAuth()?.activeProfile);
  const [items, setItems] = useState(null);

  useEffect(() => {
    setItems(null);
    let cancelled = false;
    findAdaptations(book, { kidsSafe })
      .then((result) => { if (!cancelled) setItems(result); })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, [book, kidsSafe]);

  if (!items?.length) return null;
  const background = location.state?.backgroundLocation || location;
  return (
    <section className="td-section" aria-label="Watch the adaptation">
      <div className="td-section-head"><h3>Watch the adaptation</h3></div>
      <div className="td-adapt-list td-adapt-list--screen">
        {items.slice(0, 4).map((entry) => (
          <Link key={`${entry.media_type}:${entry.id}`} to={titleUrl(entry)} state={{ backgroundLocation: background }} className="td-adapt td-adapt--screen">
            <img src={backdropSrc(entry.backdrop_url, 'w780') || posterSrc(entry.poster_url)} alt="" loading="lazy" referrerPolicy="no-referrer" />
            <span className="td-adapt-body">
              <span className="td-adapt-title">{entry.title}</span>
              <span className="td-muted">{[entry.media_type === 'tv_show' ? 'Series' : 'Movie', entry.year || String(entry.release_date || '').slice(0, 4)].filter(Boolean).join(' · ')}</span>
              <span className="td-adapt-cta"><FilmStrip size={14} weight="bold" /> {entry._comingSoon ? 'Coming soon' : 'Watch now'}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
