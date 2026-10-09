import { useEffect, useState } from 'react';
import { cachedOutsideRatings, fetchOutsideRatings, formatVotes } from '../utils/outsideRatings';

// IMDb ★ 8.1 (1.2M) · Rotten Tomatoes 94% · Metacritic 82 — on the title
// page. Falls back to the TMDB score when outside ratings aren't available.
export default function OutsideRatings({ item, tmdbScore = 0, tmdbVotes = 0 }) {
  const [ratings, setRatings] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setRatings(null);
    fetchOutsideRatings(item).then((row) => { if (!cancelled) setRatings(row); });
    return () => { cancelled = true; };
  }, [item]);

  const chips = [];
  if (ratings?.imdb_rating) {
    chips.push(
      <span key="imdb" className="or-chip or-chip--imdb" title={`IMDb ${ratings.imdb_rating}/10 from ${formatVotes(ratings.imdb_votes)} votes`}>
        <b>IMDb</b> {Number(ratings.imdb_rating).toFixed(1)}{ratings.imdb_votes ? <small>{formatVotes(ratings.imdb_votes)}</small> : null}
      </span>
    );
  }
  if (ratings?.rotten_tomatoes != null) {
    const fresh = ratings.rotten_tomatoes >= 60;
    chips.push(
      <span key="rt" className={`or-chip or-chip--rt${fresh ? ' fresh' : ' rotten'}`} title={`Rotten Tomatoes: ${ratings.rotten_tomatoes}% of critics`}>
        <b>RT</b> {ratings.rotten_tomatoes}% <small>{fresh ? 'fresh' : 'rotten'}</small>
      </span>
    );
  }
  if (ratings?.metacritic != null) {
    const tier = ratings.metacritic >= 61 ? 'good' : ratings.metacritic >= 40 ? 'mixed' : 'bad';
    chips.push(
      <span key="mc" className="or-chip or-chip--mc" title={`Metacritic ${ratings.metacritic}/100`}>
        <b className={`or-mc or-mc--${tier}`}>{ratings.metacritic}</b> Metacritic
      </span>
    );
  }
  if (!chips.length && tmdbScore > 0) {
    chips.push(
      <span key="tmdb" className="or-chip" title={`TMDB ${tmdbScore.toFixed(1)}/10 from ${formatVotes(tmdbVotes)} votes`}>
        <b>TMDB</b> {tmdbScore.toFixed(1)}{tmdbVotes ? <small>{formatVotes(tmdbVotes)}</small> : null}
      </span>
    );
  }
  if (!chips.length) return null;
  return <div className="or-strip" aria-label="Ratings">{chips}</div>;
}

// Small IMDb badge for cards, from the shared cache only.
export function useCachedImdb(item) {
  const [rating, setRating] = useState(null);
  useEffect(() => {
    let cancelled = false;
    cachedOutsideRatings(item).then((row) => { if (!cancelled) setRating(row?.imdb_rating ? Number(row.imdb_rating) : null); });
    return () => { cancelled = true; };
  }, [item]);
  return rating;
}
