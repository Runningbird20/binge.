import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { tmdbGet } from '../utils/tmdb';
import HScroll from './HScroll';

// Every episode of a show as one grid — seasons across, episodes down —
// colored by rating, so a weak season, the best episodes and "is it worth
// finishing?" are visible at a glance. TMDB ratings by default; IMDb ratings
// (via the server's OMDb lookup) when available. Click a cell to play it.

const MIN_VOTES = 3; // TMDB episode scores with fewer votes are noise

export function ratingTier(rating) {
  if (rating == null) return 'none';
  if (rating >= 9) return 'great';
  if (rating >= 8) return 'good';
  if (rating >= 7) return 'ok';
  if (rating >= 6) return 'meh';
  return 'bad';
}

async function loadTmdbSeasons(tmdbId, seasonNumbers) {
  const chunks = [];
  for (let i = 0; i < seasonNumbers.length; i += 20) chunks.push(seasonNumbers.slice(i, i + 20));
  const seasons = {};
  for (const chunk of chunks) {
    // eslint-disable-next-line no-await-in-loop
    const data = await tmdbGet(`/tv/${tmdbId}`, { append_to_response: chunk.map((n) => `season/${n}`).join(',') });
    chunk.forEach((n) => {
      const today = new Date().toISOString().slice(0, 10);
      seasons[n] = (data?.[`season/${n}`]?.episodes || []).map((episode) => ({
        episode: episode.episode_number,
        title: episode.name,
        aired: Boolean(episode.air_date) && episode.air_date <= today,
        rating: episode.vote_count >= MIN_VOTES && episode.vote_average > 0 ? Number(episode.vote_average.toFixed(1)) : null,
      }));
    });
  }
  return seasons;
}

async function loadImdbSeasons(tmdbId, seasonNumbers) {
  const results = await Promise.all(seasonNumbers.map((season) => (
    api.get(`/extras/episodes?tmdb=${tmdbId}&season=${season}`).catch(() => null)
  )));
  if (results.some((result) => result?.unavailable)) return null;
  const seasons = {};
  seasonNumbers.forEach((season, index) => {
    seasons[season] = (results[index]?.episodes || []).map((episode) => ({ ...episode, aired: true }));
  });
  return Object.values(seasons).some((list) => list.some((episode) => episode.rating != null)) ? seasons : null;
}

export default function EpisodeHeatmap({ tmdbId, seasons, onPlay }) {
  const seasonNumbers = useMemo(() => seasons.map((season) => season.season_number), [seasons]);
  const [tmdbData, setTmdbData] = useState(null);
  const [imdbData, setImdbData] = useState(undefined); // undefined loading, null unavailable
  const [source, setSource] = useState('tmdb');

  useEffect(() => {
    let cancelled = false;
    setTmdbData(null);
    setImdbData(undefined);
    loadTmdbSeasons(tmdbId, seasonNumbers).then((data) => { if (!cancelled) setTmdbData(data); }).catch(() => {});
    loadImdbSeasons(tmdbId, seasonNumbers).then((data) => {
      if (cancelled) return;
      setImdbData(data);
      if (data) setSource('imdb');
    }).catch(() => { if (!cancelled) setImdbData(null); });
    return () => { cancelled = true; };
  }, [tmdbId, seasonNumbers]);

  // IMDb view: episodes OMDb has no score for borrow the TMDB score
  // (marked), so the grid has no holes.
  const data = useMemo(() => {
    if (source !== 'imdb' || !imdbData) return tmdbData;
    if (!tmdbData) return imdbData;
    const merged = {};
    Object.keys({ ...tmdbData, ...imdbData }).forEach((season) => {
      const fromTmdb = tmdbData[season] || [];
      const fromImdb = imdbData[season] || [];
      const numbers = new Set([...fromTmdb, ...fromImdb].map((episode) => episode.episode));
      merged[season] = [...numbers].sort((a, b) => a - b).map((number) => {
        const imdb = fromImdb.find((episode) => episode.episode === number);
        const tmdb = fromTmdb.find((episode) => episode.episode === number);
        if (imdb?.rating != null) return { ...tmdb, ...imdb, aired: tmdb ? tmdb.aired : true };
        if (tmdb?.rating != null) return { ...tmdb, fallback: true };
        return { ...(tmdb || imdb), rating: null, aired: tmdb ? tmdb.aired : true };
      });
    });
    return merged;
  }, [source, imdbData, tmdbData]);

  const summary = useMemo(() => {
    if (!data) return null;
    let best = null;
    const averages = {};
    seasonNumbers.forEach((season) => {
      const rated = (data[season] || []).filter((episode) => episode.rating != null);
      averages[season] = rated.length ? rated.reduce((sum, episode) => sum + episode.rating, 0) / rated.length : null;
      rated.forEach((episode) => {
        if (!best || episode.rating > best.rating) best = { ...episode, season };
      });
    });
    const ranked = seasonNumbers.filter((season) => averages[season] != null);
    const top = ranked.length ? ranked.reduce((a, b) => (averages[b] > averages[a] ? b : a)) : null;
    const low = ranked.length > 1 ? ranked.reduce((a, b) => (averages[b] < averages[a] ? b : a)) : null;
    return { best, averages, top, low };
  }, [data, seasonNumbers]);

  if (!data) return <section className="td-section" aria-label="Episode ratings"><div className="hm-skeleton skeleton-block" aria-hidden="true" /></section>;
  if (!summary?.best) return null;

  const maxEpisodes = Math.max(...seasonNumbers.map((season) => (data[season] || []).length));
  const episodeNumbers = Array.from({ length: maxEpisodes }, (_, index) => index + 1);
  // Lay the grid out along its long side: most shows have more episodes per
  // season than seasons, so seasons become rows and episodes run across
  // (a 1-season, 24-episode show is one row, not a 24-row column). Very
  // long-running shows keep seasons across.
  const seasonsAsRows = maxEpisodes > seasonNumbers.length;

  function cell(season, episodeNumber) {
    const episode = (data[season] || []).find((entry) => entry.episode === episodeNumber);
    if (!episode) return <td key={`${season}-${episodeNumber}`} className="hm-empty" />;
    const value = episode.rating != null ? episode.rating.toFixed(1) : null;
    const label = `S${season} E${episodeNumber}${episode.title ? `: ${episode.title}` : ''} — ${value
      ? `${value}${episode.fallback ? ' (TMDB — no IMDb rating yet)' : ''}`
      : episode.aired ? 'not enough ratings' : 'not aired yet'}`;
    return (
      <td key={`${season}-${episodeNumber}`}>
        <button
          type="button"
          className={`hm-cell hm-cell--${episode.aired ? ratingTier(episode.rating) : 'future'}${summary.best.season === season && summary.best.episode === episodeNumber ? ' best' : ''}${episode.fallback ? ' fallback' : ''}`}
          onClick={() => episode.aired && onPlay?.(season, episodeNumber)}
          disabled={!episode.aired}
          title={label}
          aria-label={label}
        >
          {value || (episode.aired ? '–' : '')}
        </button>
      </td>
    );
  }

  function average(season) {
    return (
      <span className={`hm-avg hm-cell--${ratingTier(summary.averages[season])}`}>
        {summary.averages[season] != null ? summary.averages[season].toFixed(1) : '–'}
      </span>
    );
  }

  const table = seasonsAsRows ? (
    <table className="hm-grid hm-grid--rows">
      <thead>
        <tr>
          <th scope="col" className="hm-corner"><span className="sr-only">Season</span></th>
          {episodeNumbers.map((n) => <th key={n} scope="col">E{n}</th>)}
          <th scope="col" className="hm-avg-head">Avg</th>
        </tr>
      </thead>
      <tbody>
        {seasonNumbers.map((season) => (
          <tr key={season}>
            <th scope="row">S{season}</th>
            {episodeNumbers.map((n) => cell(season, n))}
            <td className="hm-avg-cell">{average(season)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  ) : (
    <table className="hm-grid">
      <thead>
        <tr>
          <th scope="col" className="hm-corner"><span className="sr-only">Episode</span></th>
          {seasonNumbers.map((season) => <th key={season} scope="col">S{season}</th>)}
        </tr>
      </thead>
      <tbody>
        {episodeNumbers.map((n) => (
          <tr key={n}>
            <th scope="row">E{n}</th>
            {seasonNumbers.map((season) => cell(season, n))}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row">Avg</th>
          {seasonNumbers.map((season) => <td key={season}>{average(season)}</td>)}
        </tr>
      </tfoot>
    </table>
  );

  return (
    <section className="td-section hm" aria-label="Episode ratings">
      <div className="td-section-head">
        <h3>Episode ratings</h3>
        {imdbData && (
          <div className="hm-source" role="radiogroup" aria-label="Rating source">
            {['imdb', 'tmdb'].map((value) => (
              <button key={value} type="button" role="radio" aria-checked={source === value} className={source === value ? 'active' : ''} onClick={() => setSource(value)}>
                {value === 'imdb' ? 'IMDb' : 'TMDB'}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="hm-summary">
        Best episode: <strong>S{summary.best.season} E{summary.best.episode}{summary.best.title ? ` “${summary.best.title}”` : ''}</strong> ({summary.best.rating.toFixed(1)})
        {summary.top != null && summary.low != null && summary.top !== summary.low && (
          <> · Strongest season <strong>{summary.top}</strong> · weakest <strong>{summary.low}</strong></>
        )}
      </p>
      <HScroll className="hm-scroll" label="episode ratings" deps={data}>
        {table}
      </HScroll>
      <div className="hm-legend" aria-hidden="true">
        {[['great', '9+'], ['good', '8–9'], ['ok', '7–8'], ['meh', '6–7'], ['bad', '<6']].map(([tier, text]) => (
          <span key={tier}><i className={`hm-cell--${tier}`} />{text}</span>
        ))}
        <span className="hm-legend-note">
          {source === 'imdb' ? 'IMDb ratings' : 'TMDB ratings'}
          {source === 'imdb' && Object.values(data).some((list) => list.some((episode) => episode.fallback)) ? ' (dotted = TMDB, no IMDb score yet)' : ''}
          {' · click an episode to play it'}
        </span>
      </div>
    </section>
  );
}
