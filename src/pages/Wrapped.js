import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CaretLeft, CaretRight, Pause, Play, ShareNetwork, Star, X } from '@phosphor-icons/react';
import { useAuth } from '../contexts/AuthContext';
import {
  fetchEpisodeHistory,
  fetchSupabaseContinueWatching,
  fetchSupabaseRatings,
  fetchSupabaseWatchlist,
} from '../utils/supabaseData';
import { languageName } from '../utils/tmdb';
import { posterSrc } from '../utils/imageQuality';
import { buildWrapped } from '../utils/wrapped';

// Wrapped is the one place binge. dresses up: your year as a run of movie
// tickets. Each stat prints on its own ticket (gold ADMIT ONE stub,
// perforation, paper body) with a marquee headline, printed line items and
// a barcode. One motion: the ticket feeds out of the printer.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SLIDE_MS = 7000;
const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;800&family=IBM+Plex+Mono:wght@400;600&display=swap';

// Only Wrapped needs these faces; load them here, not site-wide.
function useTicketFonts() {
  useEffect(() => {
    if (document.querySelector(`link[href="${FONT_HREF}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = FONT_HREF;
    document.head.appendChild(link);
  }, []);
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return undefined;
    const onChange = () => setReduced(query.matches);
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);
  return reduced;
}

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// A barcode drawn from the ticket's own text, so every ticket's differs.
function Barcode({ seed }) {
  const bars = useMemo(() => {
    let state = hash(seed) || 1;
    const out = [];
    let x = 0;
    while (x < 236) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const width = 1 + (state % 3);
      const gap = 1 + ((state >>> 8) % 3);
      out.push({ x, width });
      x += width + gap;
    }
    return out;
  }, [seed]);
  return (
    <svg className="wp-barcode" viewBox="0 0 240 40" preserveAspectRatio="none" aria-hidden="true">
      {bars.map((bar) => <rect key={bar.x} x={bar.x} y="0" width={bar.width} height="40" />)}
    </svg>
  );
}

const ticketNo = (year, index) => `${String(year).slice(2)}-${String(412 + index * 37).padStart(5, '0')}`;

// Share image: the summary ticket, on the lobby's dark floor.
async function renderShareImage(data, name, year) {
  await Promise.all([
    document.fonts?.load?.('800 120px "Barlow Condensed"'),
    document.fonts?.load?.('400 40px "IBM Plex Mono"'),
  ]).catch(() => {});
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0b0d12';
  ctx.fillRect(0, 0, 1080, 1920);

  const x = 120, y = 220, w = 840, h = 1480, stubH = 230;
  ctx.fillStyle = '#f5c451';
  ctx.fillRect(x, y, w, stubH);
  ctx.fillStyle = '#f4efe6';
  ctx.fillRect(x, y + stubH, w, h - stubH);
  // perforation notches + dashes
  ctx.fillStyle = '#0b0d12';
  [x, x + w].forEach((cx) => { ctx.beginPath(); ctx.arc(cx, y + stubH, 28, 0, Math.PI * 2); ctx.fill(); });
  ctx.strokeStyle = 'rgba(28,26,23,0.45)';
  ctx.setLineDash([14, 12]);
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(x + 40, y + stubH); ctx.lineTo(x + w - 40, y + stubH); ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = '#1c1a17';
  ctx.font = 'italic 700 64px Georgia, serif';
  ctx.fillText('binge.', x + 60, y + 110);
  ctx.font = '600 34px "IBM Plex Mono", monospace';
  ctx.fillText(`ADMIT ONE · ${year}`, x + 60, y + 175);

  ctx.font = '800 150px "Barlow Condensed", sans-serif';
  ctx.fillText(`${data.hours.toLocaleString()} HOURS`, x + 60, y + stubH + 200);
  ctx.font = '600 44px "Barlow Condensed", sans-serif';
  ctx.fillStyle = '#5a1020';
  ctx.fillText(`${name.toUpperCase()}’S YEAR AT THE BINGE. CINEMA`, x + 60, y + stubH + 270);

  const lines = [
    ['EPISODES', data.episodeCount.toLocaleString()],
    ['MOVIES', String(data.movieCount)],
    ['TITLES', String(data.titleCount)],
    ['TOP SHOW', (data.topShow?.title || '—').toUpperCase()],
    ['GENRE', (data.topGenres[0] || '—').toUpperCase()],
    ['YOU ARE', data.persona.name.toUpperCase()],
  ];
  ctx.font = '400 38px "IBM Plex Mono", monospace';
  let ly = y + stubH + 400;
  lines.forEach(([k, v]) => {
    ctx.fillStyle = 'rgba(28,26,23,0.6)';
    ctx.fillText(k, x + 60, ly);
    ctx.fillStyle = '#1c1a17';
    let value = v;
    while (ctx.measureText(value).width > 470 && value.length > 4) value = value.slice(0, -2);
    if (value !== v) value = `${value.trim()}…`;
    ctx.fillText(value, x + w - 60 - ctx.measureText(value).width, ly);
    ctx.strokeStyle = 'rgba(28,26,23,0.18)';
    ctx.beginPath(); ctx.moveTo(x + 60, ly + 26); ctx.lineTo(x + w - 60, ly + 26); ctx.stroke();
    ly += 96;
  });
  let state = hash(`${name}${year}`) || 1;
  let bx = x + 60;
  ctx.fillStyle = '#1c1a17';
  while (bx < x + w - 60) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const bw = 3 + (state % 6);
    ctx.fillRect(bx, y + h - 190, bw, 110);
    bx += bw + 3 + ((state >>> 8) % 6);
  }
  ctx.fillStyle = 'rgba(244,239,230,0.6)';
  ctx.font = '500 34px -apple-system, Helvetica, Arial, sans-serif';
  ctx.fillText('Movies · Series · Books · Sports', 120, 1830);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

const DEMO = (year) => ({
  year, hours: 412, episodeCount: 486, movieCount: 37, titleCount: 64, ratingCount: 41,
  topShow: { title: 'Squid Game', episodes: 22, image_url: 'https://image.tmdb.org/t/p/w780/dDlEmu3EZ0Pgg93K2SVNLCjCSvE.jpg' },
  topGenres: ['Thriller', 'Drama', 'Comedy'], topLanguage: 'ko', busiestMonth: 6,
  bingeDay: { date: `${year}-03-14`, count: 9 },
  favorites: [
    { media_type: 'tv_show', media_id: 1, title: 'Severance', stars: 5, image_url: 'https://image.tmdb.org/t/p/w342/pPHpeI2X1qEd1CS1SeyrdhZ4qnT.jpg' },
    { media_type: 'movie', media_id: 2, title: 'Fight Club', stars: 4.8, image_url: 'https://image.tmdb.org/t/p/w342/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg' },
    { media_type: 'tv_show', media_id: 3, title: 'The Bear', stars: 4.6, image_url: null },
  ],
  persona: { name: 'The K-Drama Devotee', line: 'Seoul was basically your second home this year.' },
});

export default function Wrapped() {
  const { user, activeProfile } = useAuth();
  const [data, setData] = useState(null);
  const [slide, setSlide] = useState(0);
  const [paused, setPaused] = useState(false);
  const [held, setHeld] = useState(false);
  const [shareState, setShareState] = useState('');
  const reducedMotion = usePrefersReducedMotion();
  const year = new Date().getFullYear();
  const name = activeProfile?.name || user?.username || 'Your';
  useTicketFonts();

  useEffect(() => {
    let cancelled = false;
    // Development only: /wrapped?demo=1 shows sample data, for design review.
    if (process.env.NODE_ENV !== 'production' && new URLSearchParams(window.location.search).get('demo')) {
      setData(DEMO(year));
      return undefined;
    }
    Promise.all([
      fetchEpisodeHistory(2000).catch(() => []),
      fetchSupabaseContinueWatching().catch(() => []),
      fetchSupabaseRatings().catch(() => []),
      fetchSupabaseWatchlist().catch(() => []),
    ]).then(([episodes, playing, ratings, watchlist]) => {
      if (!cancelled) setData(buildWrapped({ episodes, playing, ratings, watchlist }, year));
    });
    return () => { cancelled = true; };
  }, [year]);

  // Each ticket: a marquee headline, an optional sub line, printed line items.
  const tickets = useMemo(() => {
    if (!data) return [];
    const days = Math.round((data.hours / 24) * 10) / 10;
    const list = [
      {
        key: 'intro', screen: 'Opening night', title: `${name}’s ${year}`, sub: 'A year at the binge. cinema',
        lines: [['Showing', 'Movies · Series · Sports'], ['Titles', String(data.titleCount)], ['Seat', 'Yours, every night']],
      },
      {
        key: 'time', screen: 'Screen 1', title: `${data.hours.toLocaleString()} hours`, sub: `That’s about ${days} days in the dark.`,
        lines: [['Episodes', data.episodeCount.toLocaleString()], ['Movies', String(data.movieCount)], ['Titles', String(data.titleCount)]],
      },
    ];
    if (data.topShow) {
      list.push({
        key: 'show', screen: 'Now showing', title: data.topShow.title, sub: 'Your most-watched show',
        image: data.topShow.image_url, lines: [['Episodes', String(data.topShow.episodes)], ['Rewatch value', 'Off the charts']],
      });
    }
    if (data.topGenres.length) {
      list.push({
        key: 'genres', screen: 'Double feature', title: data.topGenres[0], sub: 'The genre you kept coming back to',
        lines: data.topGenres.slice(0, 3).map((genre, index) => [`No. ${index + 1}`, genre]),
      });
    }
    if (data.topLanguage && data.topLanguage !== 'en') {
      list.push({ key: 'lang', screen: 'Subtitled', title: languageName(data.topLanguage), sub: 'Your top language after English', lines: [['Subtitles', 'On']] });
    }
    if (data.bingeDay) {
      const day = new Date(data.bingeDay.date).toLocaleDateString([], { month: 'short', day: 'numeric' });
      list.push({ key: 'day', screen: 'Marathon', title: `${data.bingeDay.count} in a row`, sub: `Your biggest binge, on ${day}`, lines: [['Date', day], ['Episodes', String(data.bingeDay.count)]] });
    }
    if (data.busiestMonth != null) {
      list.push({ key: 'month', screen: 'Peak season', title: MONTHS[data.busiestMonth], sub: 'Your busiest month', lines: [['Month', MONTHS[data.busiestMonth]]] });
    }
    if (data.favorites.length) {
      list.push({ key: 'favs', screen: 'Critics’ picks', title: 'Your top rated', favorites: data.favorites.slice(0, 5) });
    }
    list.push({
      key: 'persona', screen: 'Closing night', title: data.persona.name, sub: data.persona.line,
      lines: [['Ratings', String(data.ratingCount ?? 0)], ['Hours', data.hours.toLocaleString()]], final: true,
    });
    return list;
  }, [data, name, year]);

  const go = useCallback((step) => setSlide((current) => Math.max(0, Math.min(tickets.length - 1, current + step))), [tickets.length]);

  // Tickets advance on their own, unless someone's reading, motion is
  // reduced, or it's the last one.
  const autoplay = !paused && !held && !reducedMotion && slide < tickets.length - 1 && tickets.length > 1;
  useEffect(() => {
    if (!autoplay) return undefined;
    const timer = setTimeout(() => go(1), SLIDE_MS);
    return () => clearTimeout(timer);
  }, [autoplay, slide, go]);

  useEffect(() => {
    function onKey(event) {
      if (event.key === 'ArrowRight') { event.preventDefault(); go(1); }
      if (event.key === 'ArrowLeft') go(-1);
      if (event.key === ' ') { event.preventDefault(); setPaused((value) => !value); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  async function share() {
    setShareState('Printing…');
    try {
      const blob = await renderShareImage(data, name, year);
      const file = new File([blob], `binge-wrapped-${year}.png`, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `My ${year} on binge.`, text: `I'm "${data.persona.name}" on binge. this year.` });
        setShareState('');
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        a.click();
        URL.revokeObjectURL(url);
        setShareState('Saved your ticket');
      }
    } catch (error) {
      setShareState(error?.name === 'AbortError' ? '' : 'Couldn’t share');
    }
  }

  const empty = data && data.titleCount === 0;
  const ticket = empty
    ? { key: 'empty', screen: 'Box office', title: 'No tickets yet', sub: 'Watch or rate a few things this year and your tickets print here.', lines: [] }
    : tickets[slide];

  return (
    <div
      className="wp-shell"
      // Press and hold anywhere to pause, like stories on a phone.
      onPointerDown={() => setHeld(true)}
      onPointerUp={() => setHeld(false)}
      onPointerCancel={() => setHeld(false)}
    >
      <Link to="/profile" className="wp-close" aria-label="Close Wrapped"><X size={20} weight="bold" /></Link>

      {!empty && tickets.length > 0 && (
        <div className="wp-progress" aria-hidden="true">
          {tickets.map((t, index) => (
            <span key={t.key} className={index < slide ? 'done' : index === slide ? 'now' : ''}>
              {index === slide && <i className={autoplay ? 'run' : ''} style={{ '--wp-slide': `${SLIDE_MS}ms` }} />}
            </span>
          ))}
        </div>
      )}

      <div className="wp-stage">
        {!data && <div className="wp-ticket wp-ticket--loading" aria-busy="true"><div className="wp-stub" /><div className="wp-body" /></div>}
        {ticket && (
          <article className="wp-ticket" key={ticket.key} aria-live="polite">
            <div className="wp-stub">
              <span className="wp-logo">binge.</span>
              <span className="wp-admit">Admit one</span>
              <span className="wp-screen">{ticket.screen} · {year}</span>
              <span className="wp-no">No. {ticketNo(year, slide)}</span>
            </div>
            <div className="wp-body">
              <div className={`wp-feature${ticket.image ? ' wp-feature--poster' : ''}`}>
                {ticket.image && <img className="wp-poster" src={posterSrc(ticket.image)} alt="" referrerPolicy="no-referrer" />}
                <div>
                  <h1 className="wp-title">{ticket.title}</h1>
                  {ticket.sub && <p className="wp-sub">{ticket.sub}</p>}
                </div>
              </div>
              {ticket.lines?.length > 0 && (
                <dl className="wp-lines">
                  {ticket.lines.map(([label, value]) => (
                    <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
                  ))}
                </dl>
              )}
              {ticket.favorites && (
                <ol className="wp-favs">
                  {ticket.favorites.map((fav) => (
                    <li key={`${fav.media_type}:${fav.media_id}`}>
                      {fav.image_url ? <img src={posterSrc(fav.image_url)} alt="" referrerPolicy="no-referrer" /> : <span className="wp-favs-ph" />}
                      <span className="wp-favs-title">{fav.title}</span>
                      <span className="wp-favs-score"><Star size={14} weight="fill" aria-hidden="true" /> {fav.stars.toFixed(1)}</span>
                    </li>
                  ))}
                </ol>
              )}
              <div className="wp-foot">
                <Barcode seed={`${name}-${year}-${ticket.key}`} />
                {ticket.final && (
                  <button type="button" className="wp-share" onClick={share}>
                    <ShareNetwork size={18} weight="bold" aria-hidden="true" /> {shareState || 'Share your ticket'}
                  </button>
                )}
                {empty && <Link to="/home" className="wp-share">Find something to watch</Link>}
              </div>
              {ticket.final && <span className="wp-stamp" aria-hidden="true">Admitted</span>}
            </div>
          </article>
        )}
      </div>

      {!empty && tickets.length > 0 && (
        <>
          <div className="wp-controls">
            <button type="button" className="wp-ctl" onClick={() => go(-1)} disabled={slide === 0} aria-label="Previous ticket"><CaretLeft size={22} weight="bold" /></button>
            {!reducedMotion && slide < tickets.length - 1 && (
              <button type="button" className="wp-ctl" onClick={() => setPaused((value) => !value)} aria-label={paused ? 'Play' : 'Pause'}>
                {paused ? <Play size={20} weight="fill" /> : <Pause size={20} weight="fill" />}
              </button>
            )}
            <button type="button" className="wp-ctl" onClick={() => go(1)} disabled={slide === tickets.length - 1} aria-label="Next ticket"><CaretRight size={22} weight="bold" /></button>
          </div>
          <button type="button" className="wp-tap wp-tap--left" onClick={() => go(-1)} aria-hidden="true" tabIndex={-1} />
          <button type="button" className="wp-tap wp-tap--right" onClick={() => go(1)} aria-hidden="true" tabIndex={-1} />
        </>
      )}
    </div>
  );
}
