import { useEffect, useRef, useState } from 'react';
import { api } from '../api';

const PROVIDERS = [
  { id: 'vidsrc-embed-ru', label: 'vidsrc-embed.ru', baseUrl: 'https://vidsrc-embed.ru' },
  { id: 'vidsrc-embed-su', label: 'vidsrc-embed.su', baseUrl: 'https://vidsrc-embed.su' },
  { id: 'vidsrcme-su', label: 'vidsrcme.su', baseUrl: 'https://vidsrcme.su' },
  { id: 'vsrc-su', label: 'vsrc.su', baseUrl: 'https://vsrc.su' },
];

function normalizeExternalId(kind, value) {
  if (value == null) return null;

  const normalized = String(value).trim();
  if (!normalized) return null;

  if (kind === 'tmdb' && /^\d+$/.test(normalized)) {
    return { kind: 'tmdb', value: normalized };
  }

  if (kind === 'imdb' && /^tt\d+$/i.test(normalized)) {
    return { kind: 'imdb', value: normalized.toLowerCase() };
  }

  return null;
}

function getEmbeddedId(item) {
  const candidates = [
    normalizeExternalId('tmdb', item?.tmdbId),
    normalizeExternalId('tmdb', item?.tmdb_id),
    normalizeExternalId('tmdb', item?.tmdb),
    normalizeExternalId('imdb', item?.imdbId),
    normalizeExternalId('imdb', item?.imdb_id),
    normalizeExternalId('imdb', item?.imdb),
  ];

  return candidates.find(Boolean) || null;
}

function buildUrl(providerId, externalId, mediaType, season, episode) {
  const provider = PROVIDERS.find((entry) => entry.id === providerId) || PROVIDERS[0];
  const isTV = mediaType === 'tv_show';

  if (!provider || !externalId) return null;

  const url = new URL(isTV ? '/embed/tv' : '/embed/movie', provider.baseUrl);
  url.searchParams.set(externalId.kind, externalId.value);
  url.searchParams.set('autoplay', '1');

  if (isTV) {
    url.searchParams.set('season', String(season));
    url.searchParams.set('episode', String(episode));
    url.searchParams.set('autonext', '1');
  }

  return url.toString();
}

export default function EmbedPlayer({ item, mediaType, onClose }) {
  const [provider, setProvider] = useState(PROVIDERS[0].id);
  const [season, setSeason] = useState(1);
  const [episode, setEpisode] = useState(1);
  const [externalId, setExternalId] = useState(() => getEmbeddedId(item));
  const [lookupState, setLookupState] = useState(() => (getEmbeddedId(item) ? 'done' : 'loading'));
  const [lookupError, setLookupError] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const modalRef = useRef(null);
  const iframeRef = useRef(null);
  const isTV = mediaType === 'tv_show';

  useEffect(() => {
    function onFsChange() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }

    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  useEffect(() => {
    const embeddedId = getEmbeddedId(item);

    if (embeddedId) {
      setExternalId(embeddedId);
      setLookupState('done');
      setLookupError('');
      return undefined;
    }

    let cancelled = false;

    async function fetchEmbedId() {
      setExternalId(null);
      setLookupState('loading');
      setLookupError('');

      try {
        const params = new URLSearchParams({
          title: item.title,
          type: mediaType,
          ...(item.year ? { year: item.year } : {}),
        });
        const data = await api.get(`/media/embed-id?${params}`);

        if (cancelled) return;

        if (data?.kind && data?.value) {
          setExternalId({ kind: data.kind, value: String(data.value) });
          setLookupState('done');
          setLookupError('');
        } else {
          setLookupState('error');
          setLookupError(`Could not find a provider-compatible IMDb or TMDB ID for "${item.title}".`);
        }
      } catch (err) {
        if (cancelled) return;
        setLookupState('error');
        if (err.message?.includes('Unable to reach the API')) {
          setLookupError('Unable to reach the API. Make sure the backend server is running on port 5001.');
        } else {
          setLookupError(err.message || 'The stream lookup failed.');
        }
      }
    }

    fetchEmbedId();

    return () => {
      cancelled = true;
    };
  }, [item, mediaType]);

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      const element = iframeRef.current || modalRef.current;
      element?.requestFullscreen().catch(() => {
        modalRef.current?.requestFullscreen();
      });
      return;
    }

    document.exitFullscreen();
  }

  const embedUrl = buildUrl(provider, externalId, mediaType, season, episode);
  const totalSeasons = item.seasons || 3;

  return (
    <div className="player-overlay" onClick={onClose}>
      <div className="player-modal" ref={modalRef} onClick={(event) => event.stopPropagation()}>
        <div className="player-header">
          <div className="player-title">
            <span>{isTV ? 'TV' : 'Movie'}</span>
            <div>
              <strong>{item.title}</strong>
              {item.year && <span className="player-year">{item.year}</span>}
              {externalId && (
                <span className="player-tmdb-badge">{externalId.kind.toUpperCase()} OK</span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <button
              className="player-close"
              onClick={toggleFullscreen}
              title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            >
              {isFullscreen ? '<' : '>'}
            </button>
            <button className="player-close" onClick={onClose} title="Close">X</button>
          </div>
        </div>

        {lookupState === 'loading' && (
          <div className="player-lookup-bar">
            <span className="player-lookup-dot" /> Looking up a stream ID...
          </div>
        )}
        {lookupState === 'error' && (
          <div className="player-lookup-bar player-lookup-bar--warn">
            {lookupError || `Could not find a provider-compatible IMDb or TMDB ID for "${item.title}".`}
          </div>
        )}

        {isTV && (
          <div className="player-tv-controls">
            <div className="player-control-group">
              <label>Season</label>
              <div className="player-episode-btns">
                {Array.from({ length: totalSeasons }, (_, index) => index + 1).map((value) => (
                  <button
                    key={value}
                    className={`player-ep-btn ${season === value ? 'active' : ''}`}
                    onClick={() => {
                      setSeason(value);
                      setEpisode(1);
                    }}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
            <div className="player-control-group">
              <label>Episode</label>
              <div className="player-episode-btns">
                {Array.from({ length: 20 }, (_, index) => index + 1).map((value) => (
                  <button
                    key={value}
                    className={`player-ep-btn ${episode === value ? 'active' : ''}`}
                    onClick={() => setEpisode(value)}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="player-providers">
          <span className="player-providers-label">Source:</span>
          {PROVIDERS.map((entry) => (
            <button
              key={entry.id}
              className={`player-provider-btn ${provider === entry.id ? 'active' : ''}`}
              onClick={() => setProvider(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div className="player-frame-wrap">
          {embedUrl ? (
            <iframe
              key={`${provider}-${externalId?.kind}-${externalId?.value}-${season}-${episode}`}
              ref={iframeRef}
              src={embedUrl}
              className="player-frame"
              allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
              allowFullScreen
              referrerPolicy="no-referrer"
              title={`Watch ${item.title}`}
            />
          ) : (
            <div className="player-no-url">
              <p>{lookupState === 'loading' ? 'Preparing stream...' : 'Stream unavailable right now.'}</p>
            </div>
          )}
        </div>

        <p className="player-note">
          VidSrc needs an IMDb or TMDB ID. This player now tries direct item IDs first, then an IMDb title lookup.
        </p>
      </div>
    </div>
  );
}
