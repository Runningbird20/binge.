import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { normalizeTmdbResult, tmdbGet } from '../utils/tmdb';
import { resolveTmdbItems } from '../utils/catalogLookup';
import { titleUrl } from '../components/TitleCard';

// PWA share target (manifest "share_target"): sharing a link or title to
// binge. from another app lands here. binge. links open directly; TMDB and
// IMDb links open the matching title; anything else becomes a search.
export async function resolveShared({ title = '', text = '', url = '' }, origin = window.location.origin) {
  const link = url || (String(text).match(/https?:\/\/\S+/) || [])[0] || '';
  let parsed = null;
  try { parsed = link ? new URL(link) : null; } catch { parsed = null; }

  if (parsed && parsed.origin === origin) return `${parsed.pathname}${parsed.search}`;

  let tmdb = null;
  const tmdbMatch = parsed && /themoviedb\.org$/.test(parsed.hostname) && parsed.pathname.match(/^\/(movie|tv)\/(\d+)/);
  if (tmdbMatch) {
    const kind = tmdbMatch[1];
    const data = await tmdbGet(`/${kind}/${tmdbMatch[2]}`);
    if (data) tmdb = normalizeTmdbResult({ ...data, media_type: kind }, kind === 'tv' ? 'tv_show' : 'movie');
  }
  const imdbId = parsed && /imdb\.com$/.test(parsed.hostname) && (parsed.pathname.match(/tt\d+/) || [])[0];
  if (imdbId) {
    const found = await tmdbGet(`/find/${imdbId}`, { external_source: 'imdb_id' });
    const movie = found?.movie_results?.[0];
    const show = found?.tv_results?.[0];
    if (movie) tmdb = normalizeTmdbResult(movie, 'movie');
    else if (show) tmdb = normalizeTmdbResult(show, 'tv_show');
  }
  if (tmdb) {
    const [item] = await resolveTmdbItems([tmdb], tmdb.mediaType);
    if (item) return titleUrl(item);
  }

  const words = [title, String(text).replace(/https?:\/\/\S+/g, '')].map((part) => part.trim()).filter(Boolean)[0]
    || (tmdb?.title || '');
  return words ? `/search?q=${encodeURIComponent(words.slice(0, 120))}` : '/home';
}

export default function ShareTarget() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('Opening…');

  useEffect(() => {
    let cancelled = false;
    resolveShared({ title: params.get('title') || '', text: params.get('text') || '', url: params.get('url') || '' })
      .then((path) => { if (!cancelled) navigate(path, { replace: true }); })
      .catch(() => { if (!cancelled) setStatus('Couldn’t open that link.'); });
    return () => { cancelled = true; };
  }, [params, navigate]);

  return (
    <div className="app-layout">
      <div className="page-content st-page-error"><p>{status}</p></div>
    </div>
  );
}
