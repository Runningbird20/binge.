import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { X } from '@phosphor-icons/react';
import {
  fetchEpisodeHistory,
  fetchSupabaseContinueWatching,
  fetchSupabaseRatings,
  fetchSupabaseWatchlist,
} from '../utils/supabaseData';
import { tmdbGet, tmdbIdFromItem } from '../utils/tmdb';
import { buildTicketBook, countPassport } from '../utils/wrapped';

// Wrapped's year-round companion (/wrapped?view=book): a stub per month,
// a passport stamped with the countries your films came from, and
// achievement tickets. Same ticket language as Wrapped (wp- classes).

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const regionName = (() => {
  try {
    const names = new Intl.DisplayNames(['en'], { type: 'region' });
    return (code) => names.of(code) || code;
  } catch {
    return (code) => code;
  }
})();

function tilt(text) {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) % 997;
  return (h % 15) - 7;
}

export default function TicketBook({ year, name, demo }) {
  const [book, setBook] = useState(null);
  const [passport, setPassport] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = demo
      ? Promise.resolve(demo)
      : Promise.all([
        fetchEpisodeHistory(2000).catch(() => []),
        fetchSupabaseContinueWatching().catch(() => []),
        fetchSupabaseRatings().catch(() => []),
        fetchSupabaseWatchlist().catch(() => []),
      ]).then(([episodes, playing, ratings, watchlist]) => ({ episodes, playing, ratings, watchlist }));
    load.then(async (activity) => {
      const built = buildTicketBook(activity, year);
      if (cancelled) return;
      setBook(built);
      // Countries: one TMDB lookup per title (cached), first 60 titles.
      const details = await Promise.all(built.titles.slice(0, 60).map((row) => {
        const tmdbId = tmdbIdFromItem(row);
        return tmdbId ? tmdbGet(`/${row.media_type === 'movie' ? 'movie' : 'tv'}/${tmdbId}`).catch(() => null) : null;
      }));
      if (!cancelled) setPassport(countPassport(details));
    });
    return () => { cancelled = true; };
  }, [year, demo]);

  return (
    <div className="wp-shell wp-book">
      <Link to="/profile" className="wp-close" aria-label="Close ticket book"><X size={20} weight="bold" /></Link>
      <div className="wp-book-scroll">
        <header className="wp-book-head">
          <h1>{name}’s ticket book</h1>
          <p>{year} so far, one stub a month. <Link to="/wrapped">Play your Wrapped</Link></p>
        </header>

        <section aria-labelledby="wp-months">
          <h2 id="wp-months">Monthly stubs</h2>
          <ol className="wp-stubs">
            {(book?.monthly || Array.from({ length: 12 }, (_, month) => ({ month, loading: true }))).map((entry) => (
              <li key={entry.month} className={`wp-mini${entry.future ? ' wp-mini--future' : ''}${entry.loading ? ' wp-mini--loading' : ''}`}>
                <span className="wp-mini-month">{MONTHS[entry.month]}</span>
                {entry.loading ? null : entry.future ? (
                  <span className="wp-mini-empty">Not yet</span>
                ) : entry.titles === 0 ? (
                  <span className="wp-mini-empty">Dark month</span>
                ) : (
                  <>
                    <span className="wp-mini-hours">{entry.hours} h</span>
                    <span className="wp-mini-line">{entry.episodes} {entry.episodes === 1 ? 'episode' : 'episodes'} · {entry.titles} {entry.titles === 1 ? 'title' : 'titles'}</span>
                    {entry.top && <span className="wp-mini-top">{entry.top.title}</span>}
                  </>
                )}
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="wp-passport">
          <h2 id="wp-passport">Cinema passport</h2>
          {!passport ? (
            <p className="wp-book-note">Stamping your passport…</p>
          ) : passport.length === 0 ? (
            <p className="wp-book-note">No stamps yet. Every country a movie or show of yours comes from gets one.</p>
          ) : (
            <>
              <p className="wp-book-note">{passport.length} {passport.length === 1 ? 'country' : 'countries'} visited from the couch.</p>
              <ul className="wp-stamps">
                {passport.map(({ code, count }) => (
                  <li key={code} className="wp-stamp-mark" style={{ '--tilt': `${tilt(code)}deg` }}>
                    <span className="wp-stamp-country">{regionName(code)}</span>
                    <span className="wp-stamp-count">{count} {count === 1 ? 'title' : 'titles'} · {year}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section aria-labelledby="wp-achievements">
          <h2 id="wp-achievements">Achievement tickets</h2>
          <ul className="wp-awards">
            {(book?.achievements || []).map((award) => (
              <li key={award.key} className={`wp-award${award.earned ? ' wp-award--earned' : ''}`}>
                <span className="wp-award-title">{award.title}</span>
                <span className="wp-award-line">{award.line}</span>
                {award.earned ? (
                  <span className="wp-award-stamp" aria-label="Earned">Admitted</span>
                ) : (
                  <span className="wp-award-progress" aria-label={`${award.progress} of ${award.goal}`}>
                    <i style={{ width: `${Math.round((award.progress / award.goal) * 100)}%` }} />
                    <b>{award.progress} / {award.goal}</b>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
