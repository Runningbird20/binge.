import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CaretLeft, CaretRight, ShareNetwork, Star, X } from '@phosphor-icons/react';
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

// A story is a sentence with its fact set heavy: ['You spent ', ['112 hours'], ' watching.']
function Sentence({ parts }) {
  return parts.map((part, index) => (Array.isArray(part)
    ? <strong key={index}>{part[0]}</strong>
    : <span key={index}>{part}</span>));
}

function plain(parts) {
  return parts.map((part) => (Array.isArray(part) ? part[0] : part)).join('');
}

// 1080x1920 story image for sharing: the same sentences, set large.
async function renderShareImage(slides, name, year) {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0b0d12';
  ctx.fillRect(0, 0, 1080, 1920);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'italic 700 64px Georgia, serif';
  ctx.fillText('binge.', 90, 160);
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.font = '500 40px -apple-system, Helvetica, Arial, sans-serif';
  ctx.fillText(`${name}’s ${year}`, 90, 230);

  const wrap = (text, maxWidth) => {
    const words = text.split(' ');
    const lines = [];
    let line = '';
    words.forEach((word) => {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > maxWidth && line) { lines.push(line); line = word; } else { line = next; }
    });
    if (line) lines.push(line);
    return lines;
  };
  let y = 420;
  ctx.font = '800 66px -apple-system, Helvetica, Arial, sans-serif';
  slides.filter((slide) => slide.share).slice(0, 5).forEach((slide) => {
    ctx.fillStyle = '#ffffff';
    wrap(plain(slide.title), 900).forEach((line) => { ctx.fillText(line, 90, y); y += 80; });
    y += 70;
  });
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
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
      { key: 'intro', title: [`${name}, here’s `, ['your year'], ' on binge.'], body: 'What you watched, read and loved, one story at a time.' },
      {
        key: 'time',
        share: true,
        title: ['You spent ', [`${data.hours.toLocaleString()} hours`], ' watching this year.'],
        body: `${data.episodeCount.toLocaleString()} episodes and ${data.movieCount} movies, across ${data.titleCount} titles.`,
      },
    ];
    if (data.topShow) list.push({ key: 'show', share: true, title: [[data.topShow.title], ' was your show.'], body: `You watched ${data.topShow.episodes} episodes of it.`, image: data.topShow.image_url });
    if (data.topGenres.length) {
      const g = data.topGenres.slice(0, 3);
      const parts = g.length === 1 ? [[g[0]]] : g.length === 2 ? [[g[0]], ' and ', [g[1]]] : [[g[0]], ', ', [g[1]], ' and ', [g[2]]];
      list.push({ key: 'genres', share: true, title: ['You kept coming back to ', ...parts, '.'] });
    }
    if (data.topLanguage && data.topLanguage !== 'en') list.push({ key: 'lang', title: ['After English, you watched the most in ', [languageName(data.topLanguage)], '.'] });
    if (data.bingeDay) {
      const day = new Date(data.bingeDay.date).toLocaleDateString([], { month: 'long', day: 'numeric' });
      list.push({ key: 'day', title: ['Your biggest binge: ', [`${data.bingeDay.count} episodes`], ` on ${day}.`] });
    }
    if (data.busiestMonth != null) list.push({ key: 'month', title: [[MONTHS[data.busiestMonth]], ' was your busiest month.'] });
    if (data.favorites.length) list.push({ key: 'favs', title: ['These earned ', ['your best ratings'], '.'], favorites: data.favorites });
    list.push({ key: 'persona', share: true, title: ['You’re ', [data.persona.name], '.'], body: data.persona.line, final: true });
    return list;
  }, [data, name]);

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
      const blob = await renderShareImage(slides, name, year);
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
      {!data && (
        <div className="wr-card" aria-busy="true">
          <div className="wr-skel wr-skel--title" />
          <div className="wr-skel" />
        </div>
      )}
      {empty && (
        <div className="wr-card">
          <h1 className="wr-title">Your {year} story starts with one show.</h1>
          <p className="wr-body">Watch or rate a few things this year and your recap builds itself here.</p>
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
            <h1 className="wr-title"><Sentence parts={current.title} /></h1>
            {current.body && <p className="wr-body">{current.body}</p>}
            {current.favorites && (
              <ol className="wr-favs">
                {current.favorites.map((fav) => (
                  <li key={`${fav.media_type}:${fav.media_id}`}>
                    {fav.image_url && <img src={posterSrc(fav.image_url)} alt="" referrerPolicy="no-referrer" />}
                    <span>{fav.title}</span>
                    <strong><Star size={14} weight="fill" aria-hidden="true" /> {fav.stars.toFixed(1)}</strong>
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
