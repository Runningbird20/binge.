import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CaretLeft, CaretRight, ShareNetwork, X } from '@phosphor-icons/react';
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

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// 1080x1920 story image for sharing.
async function renderShareImage(w, name) {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 1080, 1920);
  gradient.addColorStop(0, '#2b1b5a');
  gradient.addColorStop(0.5, '#0f1220');
  gradient.addColorStop(1, '#5a1b2b');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1080, 1920);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'italic 700 64px Georgia, serif';
  ctx.fillText('binge.', 90, 160);
  ctx.font = '700 44px -apple-system, Helvetica, Arial, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText(`${name}'s ${w.year} Wrapped`, 90, 240);
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 200px -apple-system, Helvetica, Arial, sans-serif';
  ctx.fillText(w.hours.toLocaleString(), 90, 520);
  ctx.font = '600 52px -apple-system, Helvetica, Arial, sans-serif';
  ctx.fillText('hours watched', 90, 600);
  const lines = [
    ['You are', w.persona.name],
    ['Top show', w.topShow ? w.topShow.title : '—'],
    ['Top genres', w.topGenres.join(', ') || '—'],
    ['Titles', `${w.titleCount} · ${w.episodeCount} episodes`],
    ['Favorite', w.favorites[0]?.title || '—'],
  ];
  let y = 800;
  lines.forEach(([label, value]) => {
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '600 38px -apple-system, Helvetica, Arial, sans-serif';
    ctx.fillText(label.toUpperCase(), 90, y);
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 64px -apple-system, Helvetica, Arial, sans-serif';
    let text = String(value);
    while (ctx.measureText(text).width > 900 && text.length > 4) text = `${text.slice(0, -2)}`;
    if (text !== String(value)) text = `${text.trim()}…`;
    ctx.fillText(text, 90, y + 76);
    y += 200;
  });
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '500 34px -apple-system, Helvetica, Arial, sans-serif';
  ctx.fillText('Movies · Series · Books · Sports', 90, 1830);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

export default function Wrapped() {
  const { user, activeProfile } = useAuth();
  const [data, setData] = useState(null);
  const [slide, setSlide] = useState(0);
  const [shareState, setShareState] = useState('');
  const year = new Date().getFullYear();
  const name = activeProfile?.name || user?.username || 'Your';

  useEffect(() => {
    let cancelled = false;
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

  const slides = useMemo(() => {
    if (!data) return [];
    const list = [
      { key: 'intro', kicker: `${name}'s ${year}`, title: 'Your year on binge.', body: 'Here’s what you watched, read and loved.' },
      { key: 'time', kicker: 'Time well spent', big: data.hours.toLocaleString(), title: 'hours watched', body: `${data.episodeCount} episodes · ${data.movieCount} movies · ${data.titleCount} titles in all` },
    ];
    if (data.topShow) list.push({ key: 'show', kicker: 'Your most-binged show', title: data.topShow.title, body: `${data.topShow.episodes} episodes this year`, image: data.topShow.image_url });
    if (data.topGenres.length) list.push({ key: 'genres', kicker: 'Your top genres', list: data.topGenres });
    if (data.topLanguage && data.topLanguage !== 'en') list.push({ key: 'lang', kicker: 'You watched the world', title: languageName(data.topLanguage), body: 'was your most-watched language after English.' });
    if (data.bingeDay) list.push({ key: 'day', kicker: 'Your biggest binge', big: String(data.bingeDay.count), title: 'episodes in one day', body: new Date(data.bingeDay.date).toLocaleDateString([], { month: 'long', day: 'numeric' }) });
    if (data.busiestMonth != null) list.push({ key: 'month', kicker: 'Your busiest month', title: MONTHS[data.busiestMonth] });
    if (data.favorites.length) list.push({ key: 'favs', kicker: 'Your highest rated', favorites: data.favorites });
    list.push({ key: 'persona', kicker: 'Your binge personality', title: data.persona.name, body: data.persona.line, final: true });
    return list;
  }, [data, name, year]);

  const go = useCallback((step) => setSlide((current) => Math.max(0, Math.min(slides.length - 1, current + step))), [slides.length]);

  useEffect(() => {
    function onKey(event) {
      if (event.key === 'ArrowRight' || event.key === ' ') { event.preventDefault(); go(1); }
      if (event.key === 'ArrowLeft') go(-1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  async function share() {
    setShareState('Preparing…');
    try {
      const blob = await renderShareImage(data, name);
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
        setShareState('Saved image');
      }
    } catch (error) {
      setShareState(error?.name === 'AbortError' ? '' : 'Couldn’t share');
    }
  }

  const current = slides[slide];
  const empty = data && data.titleCount === 0;

  return (
    <div className="wr-shell">
      <Link to="/profile" className="wr-close" aria-label="Close Wrapped"><X size={20} weight="bold" /></Link>
      {!data && <div className="wr-card"><p className="wr-kicker">Building your year…</p></div>}
      {empty && (
        <div className="wr-card">
          <p className="wr-kicker">{year}</p>
          <h1 className="wr-title">Your Wrapped is still loading up</h1>
          <p className="wr-body">Watch and rate a few things this year and your recap will appear here.</p>
          <Link to="/home" className="st-btn st-btn--primary">Find something to watch</Link>
        </div>
      )}
      {data && !empty && current && (
        <>
          <div className="wr-progress" aria-hidden="true">
            {slides.map((s, index) => <span key={s.key} className={index <= slide ? 'on' : ''} />)}
          </div>
          <div className={`wr-card wr-card--${current.key}`} key={current.key} aria-live="polite">
            {current.image && <img className="wr-image" src={posterSrc(current.image)} alt="" referrerPolicy="no-referrer" />}
            <p className="wr-kicker">{current.kicker}</p>
            {current.big && <p className="wr-big">{current.big}</p>}
            {current.title && <h1 className="wr-title">{current.title}</h1>}
            {current.body && <p className="wr-body">{current.body}</p>}
            {current.list && <ol className="wr-list">{current.list.map((item) => <li key={item}>{item}</li>)}</ol>}
            {current.favorites && (
              <ol className="wr-favs">
                {current.favorites.map((fav) => (
                  <li key={`${fav.media_type}:${fav.media_id}`}>
                    {fav.image_url && <img src={posterSrc(fav.image_url)} alt="" referrerPolicy="no-referrer" />}
                    <span>{fav.title}</span>
                    <strong>★ {fav.stars.toFixed(1)}</strong>
                  </li>
                ))}
              </ol>
            )}
            {current.final && (
              <button type="button" className="st-btn st-btn--primary wr-share" onClick={share}>
                <ShareNetwork size={18} weight="bold" /> {shareState || 'Share your Wrapped'}
              </button>
            )}
          </div>
          <button type="button" className="wr-nav wr-nav--left" onClick={() => go(-1)} disabled={slide === 0} aria-label="Previous"><CaretLeft size={24} weight="bold" /></button>
          <button type="button" className="wr-nav wr-nav--right" onClick={() => go(1)} disabled={slide === slides.length - 1} aria-label="Next"><CaretRight size={24} weight="bold" /></button>
          <button type="button" className="wr-tap wr-tap--left" onClick={() => go(-1)} aria-hidden="true" tabIndex={-1} />
          <button type="button" className="wr-tap wr-tap--right" onClick={() => go(1)} aria-hidden="true" tabIndex={-1} />
        </>
      )}
    </div>
  );
}
