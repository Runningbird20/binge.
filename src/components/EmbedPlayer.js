import { useState, useEffect } from 'react';
import { api } from '../api';

const PROVIDERS = [
  { id: 'vidsrc',    label: 'Vidsrc'    },
  { id: 'vidsrc2',   label: 'Vidsrc 2'  },
  { id: 'superembed',label: 'SuperEmbed'},
  { id: '2embed',    label: '2Embed'    },
];

function buildUrl(provider, tmdbId, mediaType, season, episode) {
  const isTV = mediaType === 'tv_show';

  if (!tmdbId) return null;

  if (provider === 'vidsrc') {
    if (isTV) return `https://vidsrc.me/embed/tv?tmdb=${tmdbId}&season=${season}&episode=${episode}`;
    return `https://vidsrc.me/embed/movie?tmdb=${tmdbId}`;
  }
  if (provider === 'vidsrc2') {
    if (isTV) return `https://vidsrc.to/embed/tv/${tmdbId}/${season}/${episode}`;
    return `https://vidsrc.to/embed/movie/${tmdbId}`;
  }
  if (provider === 'superembed') {
    if (isTV) return `https://multiembed.mov/?video_id=${tmdbId}&tmdb=1&s=${season}&e=${episode}`;
    return `https://multiembed.mov/?video_id=${tmdbId}&tmdb=1`;
  }
  if (provider === '2embed') {
    if (isTV) return `https://www.2embed.cc/embedtv/${tmdbId}&s=${season}&e=${episode}`;
    return `https://www.2embed.cc/embed/${tmdbId}`;
  }
  return null;
}

export default function EmbedPlayer({ item, mediaType, onClose }) {
  const [provider, setProvider]   = useState('vidsrc');
  const [season, setSeason]       = useState(1);
  const [episode, setEpisode]     = useState(1);
  const [tmdbId, setTmdbId]       = useState(null);
  const [lookupState, setLookupState] = useState('loading'); // loading | done | error | no-key
  const isTV = mediaType === 'tv_show';

  useEffect(() => {
    async function fetchTmdbId() {
      setLookupState('loading');
      try {
        const params = new URLSearchParams({
          title: item.title,
          type: mediaType,
          ...(item.year ? { year: item.year } : {}),
        });
        const data = await api.get(`/media/tmdb-id?${params}`);
        if (data.id) {
          setTmdbId(data.id);
          setLookupState('done');
        } else {
          setLookupState('error');
        }
      } catch (err) {
        if (err.message?.includes('TMDB_API_KEY') || err.message?.includes('503')) {
          setLookupState('no-key');
        } else {
          setLookupState('error');
        }
      }
    }
    fetchTmdbId();
  }, [item.title, item.year, mediaType]);

  // Fallback URL using title when no TMDB ID available
  function getFallbackUrl() {
    const title = encodeURIComponent(item.title);
    if (provider === 'vidsrc') {
      if (isTV) return `https://vidsrc.me/embed/tv?tmdb=${title}&season=${season}&episode=${episode}`;
      return `https://vidsrc.me/embed/movie?tmdb=${title}`;
    }
    if (provider === 'superembed') {
      if (isTV) return `https://multiembed.mov/?video_id=${title}&tmdb=1&s=${season}&e=${episode}`;
      return `https://multiembed.mov/?video_id=${title}&tmdb=1`;
    }
    return `https://vidsrc.me/embed/${isTV ? 'tv' : 'movie'}?tmdb=${title}`;
  }

  const embedUrl = tmdbId
    ? buildUrl(provider, tmdbId, mediaType, season, episode)
    : getFallbackUrl();

  const totalSeasons = item.seasons || 3;

  return (
    <div className="player-overlay" onClick={onClose}>
      <div className="player-modal" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="player-header">
          <div className="player-title">
            <span>{isTV ? '📺' : '🎬'}</span>
            <div>
              <strong>{item.title}</strong>
              {item.year && <span className="player-year">{item.year}</span>}
              {tmdbId && <span className="player-tmdb-badge">TMDB ✓</span>}
            </div>
          </div>
          <button className="player-close" onClick={onClose}>✕</button>
        </div>

        {/* TMDB lookup status */}
        {lookupState === 'loading' && (
          <div className="player-lookup-bar">
            <span className="player-lookup-dot" /> Looking up media ID...
          </div>
        )}
        {lookupState === 'error' && (
          <div className="player-lookup-bar player-lookup-bar--warn">
            ⚠️ Could not find TMDB ID for "{item.title}" — stream may not load.
          </div>
        )}
        {lookupState === 'no-key' && (
          <div className="player-lookup-bar player-lookup-bar--warn">
            ⚠️ Add <code>TMDB_API_KEY</code> to your .env for better stream matching.
            Get a free key at <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer">themoviedb.org</a>
          </div>
        )}

        {/* TV Controls */}
        {isTV && (
          <div className="player-tv-controls">
            <div className="player-control-group">
              <label>Season</label>
              <div className="player-episode-btns">
                {Array.from({ length: totalSeasons }, (_, i) => i + 1).map(s => (
                  <button
                    key={s}
                    className={`player-ep-btn ${season === s ? 'active' : ''}`}
                    onClick={() => { setSeason(s); setEpisode(1); }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div className="player-control-group">
              <label>Episode</label>
              <div className="player-episode-btns">
                {Array.from({ length: 20 }, (_, i) => i + 1).map(e => (
                  <button
                    key={e}
                    className={`player-ep-btn ${episode === e ? 'active' : ''}`}
                    onClick={() => setEpisode(e)}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Provider switcher */}
        <div className="player-providers">
          <span className="player-providers-label">Source:</span>
          {PROVIDERS.map(p => (
            <button
              key={p.id}
              className={`player-provider-btn ${provider === p.id ? 'active' : ''}`}
              onClick={() => setProvider(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* iFrame */}
        <div className="player-frame-wrap">
          {embedUrl ? (
            <iframe
              key={`${provider}-${tmdbId}-${season}-${episode}`}
              src={embedUrl}
              className="player-frame"
              allowFullScreen
              allow="autoplay; fullscreen; picture-in-picture"
              referrerPolicy="no-referrer"
              title={`Watch ${item.title}`}
            />
          ) : (
            <div className="player-no-url">
              <p>⏳ Preparing stream...</p>
            </div>
          )}
        </div>

        <p className="player-note">
          If the video doesn't load, try switching sources. A TMDB API key improves accuracy.
        </p>
      </div>
    </div>
  );
}
