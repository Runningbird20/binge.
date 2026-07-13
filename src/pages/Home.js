import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Onboarding from '../components/Onboarding';
import { computeNormalizedScore } from '../components/RatingArtifact';
import ThemedSelect from '../components/ThemedSelect';
import UserAvatar from '../components/UserAvatar';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import {
  fetchSupabaseRatings,
  fetchSupabaseWatchlist,
  fetchSupabaseContinueWatching,
  removeSupabaseContinueWatching,
  updateWatchlistProgress,
  removeSupabaseWatchlistItem,
} from '../utils/supabaseData';
import { generateSupabaseTypeRecommendations } from '../utils/recommendations';

const MEDIA_ICONS = {
  movie: '🎬',
  tv_show: '📺',
  book: '📚',
};

function resolvePosterUrl(url) {
  if (!url) return null;

  try {
    if (url.includes('plex.tv')) {
      const parsed = new URL(url);
      const inner = parsed.searchParams.get('url');
      if (inner) {
        try {
          return decodeURIComponent(inner);
        } catch {
          return inner;
        }
      }
    }
  } catch {
    return url;
  }

  return url;
}

const HERO_TYPE_LABELS = { movie: 'Movie', tv_show: 'Series', book: 'Book' };

function detailsUrl(item) {
  if (item.media_type === 'movie') return `/movie/${item.media_id}`;
  if (item.media_type === 'tv_show') return `/tv-show/${item.media_id}`;
  if (item.media_type === 'book') return `/book/${item.media_id}`;
  return '/home';
}

function resumeUrl(item) {
  if (item.media_type === 'movie') return `/movie/${item.media_id}?play=1`;
  if (item.media_type === 'tv_show') return `/tv-show/${item.media_id}?play=1`;
  return detailsUrl(item);
}

function StreamHero({ user, continueWatchingItems, watchlistItems }) {
  const location = useLocation();
  const inProgressItem = continueWatchingItems.find(
    (item) => resolvePosterUrl(item.image_url || item.poster_url)
  ) || null;
  const libraryItem = watchlistItems.find(
    (item) => resolvePosterUrl(item.image_url || item.poster_url)
  ) || null;
  const heroItem = inProgressItem || libraryItem;
  const poster = heroItem ? resolvePosterUrl(heroItem.image_url || heroItem.poster_url) : null;
  const inProgress = Boolean(inProgressItem) && heroItem === inProgressItem;

  return (
    <section className="stream-hero">
      {poster && (
        <div
          className="stream-hero-backdrop"
          style={{ backgroundImage: `url(${poster})` }}
          aria-hidden="true"
        />
      )}
      <div className="stream-hero-scrim" aria-hidden="true" />
      <div className="stream-hero-content">
        <p className="stream-hero-kicker">Welcome back, {user.username}</p>
        <h1 className="stream-hero-title">
          {heroItem ? heroItem.title : 'What will you binge tonight?'}
        </h1>
        <div className="stream-hero-meta">
          {heroItem ? (
            <>
              <span className="stream-hero-chip">
                {HERO_TYPE_LABELS[heroItem.media_type] || 'Title'}
              </span>
              {heroItem.year && <span>{heroItem.year}</span>}
              <span className="stream-hero-dot">•</span>
              <span>{inProgress ? 'Continue where you left off' : 'From your library'}</span>
            </>
          ) : (
            <span>Pick up where you left off or discover something new.</span>
          )}
        </div>
        <div className="stream-hero-actions">
          {heroItem ? (
            <>
              <Link
                className="btn-primary"
                to={inProgress ? resumeUrl(heroItem) : detailsUrl(heroItem)}
                state={{ backgroundLocation: location }}
              >
                {inProgress ? 'Resume' : 'Details'}
              </Link>
              <Link className="btn-secondary" to="/home">My Library</Link>
            </>
          ) : (
            <>
              <Link className="btn-primary" to="/movies">Browse Movies</Link>
              <Link className="btn-secondary" to="/tv-shows">Browse Series</Link>
            </>
          )}
        </div>
      </div>
      {poster && (
        <img
          className="stream-hero-poster"
          src={poster}
          alt={heroItem.title}
          referrerPolicy="no-referrer"
        />
      )}
    </section>
  );
}

function ContinueWatching({ items, onRemove }) {
  const location = useLocation();
  if (!items.length) return null;

  return (
    <section className="home-section">
      <div className="section-header">
        <h2>Continue Watching</h2>
      </div>
      <div className="continue-watching-row">
        {items.map(item => {
          const poster = resolvePosterUrl(item.image_url || item.poster_url);
          const url = resumeUrl(item);

          const s  = item.current_season;
          const e  = item.current_episode;
          const ch = item.current_chapter;
          const pg = item.current_page;

          let badge = null;
          let sub   = null;
          if (item.media_type === 'tv_show' && (s || e)) {
            badge = `S${s || 1} E${e || 1}`;
            sub   = `Season ${s || 1}, Ep ${e || 1}`;
          } else if (item.media_type === 'book' && (ch || pg)) {
            badge = ch ? `Ch ${ch}` : `Pg ${pg}`;
            sub   = [ch ? `Chapter ${ch}` : null, pg ? `Page ${pg}` : null].filter(Boolean).join(', ');
          } else {
            sub = item.media_type === 'book' ? 'Reading' : 'Watching';
          }

          return (
            <div key={item.id} className="continue-card-wrap">
              <Link to={url} className="continue-card" state={{ backgroundLocation: location }}>
                <div className="continue-card-poster">
                  {poster
                    ? <img src={poster} alt={item.title} referrerPolicy="no-referrer" />
                    : <div className="continue-card-placeholder">{MEDIA_ICONS[item.media_type]}</div>
                  }
                  <div className="continue-card-play">▶</div>
                  {badge && <div className="continue-card-badge">{badge}</div>}
                </div>
                <p className="continue-card-title">{item.title}</p>
                <p className="continue-card-sub">{sub}</p>
              </Link>
              <button
                type="button"
                className="continue-card-remove"
                title="Remove from Continue Watching"
                aria-label={`Remove ${item.title} from Continue Watching`}
                onClick={(event) => { event.preventDefault(); onRemove(item.id); }}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

const FOR_YOU_TABS = [
  { id: 'movie', label: 'Movies', icon: '🎬' },
  { id: 'tv_show', label: 'TV Shows', icon: '📺' },
  { id: 'book', label: 'Books', icon: '📚' },
];
const FOR_YOU_LABELS = { movie: 'Movie', tv_show: 'TV Show', book: 'Book' };
const FOR_YOU_IDLE_STATE = { movie: 'idle', tv_show: 'idle', book: 'idle' };

function ForYouCard({ rec }) {
  const location = useLocation();
  return (
    <Link to={rec.siteUrl} className="foryou-card" state={{ backgroundLocation: location }}>
      <div className="foryou-card-poster">
        {rec.posterUrl ? (
          <img src={rec.posterUrl} alt={rec.title} />
        ) : (
          <div className="foryou-card-placeholder">{MEDIA_ICONS[rec.media_type]}</div>
        )}
      </div>
      <div className="foryou-card-body">
        <div className="foryou-card-type">
          {MEDIA_ICONS[rec.media_type]} {FOR_YOU_LABELS[rec.media_type]}
          {rec.year && <span className="foryou-card-year">{rec.year}</span>}
        </div>
        <h4 className="foryou-card-title">{rec.title}</h4>
        {rec.genre && <p className="foryou-card-genre">{rec.genre.split(',')[0].trim()}</p>}
      </div>
    </Link>
  );
}

function ForYouSection({ ready }) {
  const [activeType, setActiveType]     = useState('movie');
  const [tabState, setTabState]         = useState(FOR_YOU_IDLE_STATE);
  const [tabData, setTabData]           = useState({});
  const [tabError, setTabError]         = useState({});

  const fetchType = useCallback(async (mediaType) => {
    setTabState((prev) => ({ ...prev, [mediaType]: 'loading' }));
    setTabError((prev) => ({ ...prev, [mediaType]: '' }));
    try {
      const result = await generateSupabaseTypeRecommendations(mediaType);
      setTabData((prev) => ({ ...prev, [mediaType]: result }));
      setTabState((prev) => ({ ...prev, [mediaType]: result.recommendations?.length ? 'done' : 'empty' }));
    } catch (err) {
      setTabError((prev) => ({ ...prev, [mediaType]: String(err?.message || '').trim() || 'Something went wrong.' }));
      setTabState((prev) => ({ ...prev, [mediaType]: 'error' }));
    }
  }, []);

  useEffect(() => {
    if (ready && tabState[activeType] === 'idle') fetchType(activeType);
  }, [ready, activeType, tabState, fetchType]);

  const state = tabState[activeType];
  const data = tabData[activeType];
  const error = tabError[activeType];

  return (
    <section className="home-section surface-panel" id="for-you">
      <div className="foryou-header">
        <h2>For You</h2>
        <div className="books-tab-bar foryou-tab-bar">
          {FOR_YOU_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`books-tab ${activeType === tab.id ? 'active' : ''}`}
              onClick={() => setActiveType(tab.id)}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="foryou-section">
        {state === 'loading' && (
          <div className="foryou-loading">
            <div className="foryou-loading-owl">🍿</div>
            <p>Matching your taste...</p>
            <div className="foryou-loading-dots"><span /><span /><span /></div>
          </div>
        )}

        {state === 'error' && (
          <div className="foryou-error">
            <p>⚠️ {error}</p>
            <button type="button" className="foryou-generate-btn" onClick={() => fetchType(activeType)}>Try again</button>
          </div>
        )}

        {state === 'empty' && (
          <div className="foryou-idle">
            <p className="foryou-idle-text">
              {data?.message || 'Rate some movies, TV shows, or books first to unlock personalized recommendations!'}
            </p>
            <Link to="/movies" className="foryou-generate-btn" style={{ textDecoration: 'none', display: 'inline-block' }}>
              Browse & Rate Media
            </Link>
          </div>
        )}

        {state === 'done' && data && (
          <>
            <div className="foryou-grid">
              {data.recommendations.map((rec) => (
                <ForYouCard key={`${rec.media_type}:${rec.id}`} rec={rec} />
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

const WL_STATUS_LABELS = { watching: 'Watching', watched: 'Watched', plan_to_watch: 'Plan to Watch', reading: 'Reading', read: 'Read', plan_to_read: 'Plan to Read' };
const WL_STATUS_COLORS = { watching: '#f4f6f8', watched: '#4caf82', reading: '#f4f6f8', read: '#4caf82', plan_to_watch: '#7ab8e8', plan_to_read: '#7ab8e8' };

const TV_STATUSES   = ['plan_to_watch', 'watching', 'watched'];
const BOOK_STATUSES = ['plan_to_read', 'reading', 'read'];

function LibraryCard({ item, ratingScore, onUpdate, onRemove }) {
  const location = useLocation();
  const [status, setStatus]   = useState(item.status);
  const [season, setSeason]   = useState(item.current_season ?? '');
  const [episode, setEpisode] = useState(item.current_episode ?? '');
  const [chapter, setChapter] = useState(item.current_chapter ?? '');
  const [page, setPage]       = useState(item.current_page ?? '');
  const [saving, setSaving]   = useState(false);
  const pendingRef  = useRef({});
  const debounceRef = useRef(null);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const mediaUrl = item.media_type === 'movie'
    ? (status === 'watching' ? `/movie/${item.media_id}?play=1` : `/movie/${item.media_id}`)
    : item.media_type === 'tv_show'
    ? (status === 'watching' ? `/tv-show/${item.media_id}?play=1` : `/tv-show/${item.media_id}`)
    : `/book/${item.media_id}`;

  async function save(updates) {
    setSaving(true);
    try {
      await updateWatchlistProgress({ mediaType: item.media_type, mediaId: item.media_id, ...updates });
      onUpdate?.(item.id, updates);
    } catch {}
    finally { setSaving(false); }
  }

  async function handleStatusChange(e) {
    const val = e.target.value;
    setStatus(val);
    await save({ status: val });
  }

  function scheduleProgressSave(field, value) {
    pendingRef.current[field] = value;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const pending = { ...pendingRef.current };
      pendingRef.current = {};
      save(pending);
    }, 750);
  }

  function handleSeasonChange(e)  { const n = parseInt(e.target.value, 10); setSeason(e.target.value);  if (!isNaN(n) && n > 0) scheduleProgressSave('currentSeason', n); }
  function handleEpisodeChange(e) { const n = parseInt(e.target.value, 10); setEpisode(e.target.value); if (!isNaN(n) && n > 0) scheduleProgressSave('currentEpisode', n); }
  function handleChapterChange(e) { const n = parseInt(e.target.value, 10); setChapter(e.target.value); if (!isNaN(n) && n > 0) scheduleProgressSave('currentChapter', n); }
  function handlePageChange(e)    { const n = parseInt(e.target.value, 10); setPage(e.target.value);    if (!isNaN(n) && n > 0) scheduleProgressSave('currentPage', n); }

  const poster   = resolvePosterUrl(item.poster_url || item.image_url);
  const color    = WL_STATUS_COLORS[status] || '#555';
  const statuses = item.media_type === 'book' ? BOOK_STATUSES : TV_STATUSES;

  const progressBadge = item.media_type === 'tv_show' && (season !== '' || episode !== '')
    ? `S${season || '?'} · E${episode || '?'}`
    : item.media_type === 'book' && (chapter !== '' || page !== '')
    ? [chapter ? `Ch ${chapter}` : null, page ? `Pg ${page}` : null].filter(Boolean).join(' · ')
    : null;

  const indicator = ratingScore != null
    ? { kind: 'rated',    glyph: `★ ${ratingScore}`, title: `Rated ${ratingScore}/10` }
    : status === 'watched' || status === 'read'
    ? { kind: 'done',     glyph: '✓', title: 'Completed' }
    : status === 'watching' || status === 'reading'
    ? { kind: 'progress', glyph: '◔', title: 'In progress' }
    : { kind: 'new',      glyph: '',  title: 'Not started' };

  return (
    <div className={`profile-wl-card profile-wl-card--own${saving ? ' profile-wl-card--saving' : ''}`}>
      <div className="profile-wl-poster">
        {poster
          ? <img src={poster} alt={item.title} referrerPolicy="no-referrer" />
          : <div className="profile-wl-placeholder">{MEDIA_ICONS[item.media_type]}</div>}
        {progressBadge && <span className="profile-wl-progress-badge">{progressBadge}</span>}
        <span className={`profile-wl-status-ind profile-wl-status-ind--${indicator.kind}`} title={indicator.title}>
          {indicator.glyph}
        </span>

        <div className="profile-wl-overlay">
          <div className="profile-wl-overlay-top">
            <Link to={mediaUrl} className="profile-wl-overlay-open" state={{ backgroundLocation: location }} onClick={e => e.stopPropagation()}>
              Open →
            </Link>
            <button
              type="button"
              className="profile-wl-overlay-remove"
              title="Remove from library"
              onClick={e => { e.stopPropagation(); onRemove?.(item); }}
            >
              ✕
            </button>
          </div>
          <div className="profile-wl-overlay-controls">
            {item.media_type === 'tv_show' && (
              <div className="profile-wl-overlay-progress">
                <div className="profile-wl-overlay-field">
                  <span className="profile-wl-overlay-label">Season</span>
                  <input type="number" min="1" className="profile-wl-overlay-input" value={season} placeholder="—" onChange={handleSeasonChange} onClick={e => e.stopPropagation()} />
                </div>
                <div className="profile-wl-overlay-field">
                  <span className="profile-wl-overlay-label">Episode</span>
                  <input type="number" min="1" className="profile-wl-overlay-input" value={episode} placeholder="—" onChange={handleEpisodeChange} onClick={e => e.stopPropagation()} />
                </div>
              </div>
            )}
            {item.media_type === 'book' && (
              <div className="profile-wl-overlay-progress">
                <div className="profile-wl-overlay-field">
                  <span className="profile-wl-overlay-label">Chapter</span>
                  <input type="number" min="1" className="profile-wl-overlay-input" value={chapter} placeholder="—" onChange={handleChapterChange} onClick={e => e.stopPropagation()} />
                </div>
                <div className="profile-wl-overlay-field">
                  <span className="profile-wl-overlay-label">Page</span>
                  <input type="number" min="1" className="profile-wl-overlay-input" value={page} placeholder="—" onChange={handlePageChange} onClick={e => e.stopPropagation()} />
                </div>
              </div>
            )}
            <ThemedSelect
              className="profile-wl-overlay-status"
              value={status}
              aria-label="Watchlist status"
              options={statuses.map(s => ({ value: s, label: WL_STATUS_LABELS[s] }))}
              onChange={handleStatusChange}
              disabled={saving}
              style={{ color, borderColor: color + '55' }}
              onClick={e => e.stopPropagation()}
            />
          </div>
        </div>
      </div>
      <p className="profile-wl-title">{item.title || '—'}</p>
      {item.year && <p className="profile-wl-year">{item.year}</p>}
    </div>
  );
}

function DashboardLibrarySection({ user, watchlist, ratings, loading, onWatchlistUpdate, onWatchlistRemove }) {
  const [wlTypeFilter, setWlTypeFilter] = useState('');

  const filteredWatchlist = watchlist.filter(item => {
    return !wlTypeFilter || item.media_type === wlTypeFilter;
  });

  const ratingScores = useMemo(() => {
    const map = new Map();
    ratings.forEach(r => {
      const score = computeNormalizedScore(r.media_type, r);
      if (score != null) map.set(`${r.media_type}:${r.media_id}`, score);
    });
    return map;
  }, [ratings]);

  const stats = useMemo(() => {
    const completed  = watchlist.filter(i => i.status === 'watched' || i.status === 'read').length;
    const inProgress = watchlist.filter(i => i.status === 'watching' || i.status === 'reading').length;

    const scores = ratings.map(r => computeNormalizedScore(r.media_type, r)).filter(s => s != null);
    const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : '—';

    // The catalog has no per-title runtime data, so estimate: watched
    // movies at ~115 min each, tracked TV progress at ~45 min/episode
    // assuming ~10 episodes per season.
    let minutes = 0;
    watchlist.forEach(i => {
      if (i.media_type === 'movie' && i.status === 'watched') minutes += 115;
      if (i.media_type === 'tv_show') {
        const season  = Number(i.current_season)  || 0;
        const episode = Number(i.current_episode) || 0;
        if (season || episode) minutes += (Math.max(season - 1, 0) * 10 + episode) * 45;
      }
    });

    return { completed, inProgress, avg, minutes, totalRatings: ratings.length };
  }, [watchlist, ratings]);

  return (
    <section className="home-section dashboard-section">
      <div className="profile-header">
        <div className="profile-avatar-wrap">
          <UserAvatar avatarUrl={user.avatarUrl} name={user.username} size="lg" />
        </div>
        <div className="profile-info">
          <h1 className="profile-username">{user.username}</h1>
          <p className="profile-minutes">
            <span className="profile-minutes-num">{stats.minutes.toLocaleString()}</span> minutes watched
          </p>
        </div>
        <div className="profile-actions profile-actions--stacked">
          <Link to="/account-settings" className="btn-ghost">Edit Profile</Link>
          <div className="profile-stat-squares">
            <div className="profile-stat-square">
              <span className="profile-stat-square-num">{stats.completed}</span>
              <span className="profile-stat-square-label">Completed</span>
            </div>
            <div className="profile-stat-square">
              <span className="profile-stat-square-num">{stats.inProgress}</span>
              <span className="profile-stat-square-label">In Progress</span>
            </div>
            <div className="profile-stat-square">
              <span className="profile-stat-square-num">{stats.totalRatings}</span>
              <span className="profile-stat-square-label">Ratings</span>
            </div>
            <div className="profile-stat-square">
              <span className="profile-stat-square-num">{stats.avg}</span>
              <span className="profile-stat-square-label">Avg Score</span>
            </div>
          </div>
        </div>
      </div>

      <div className="section-header">
        <h2>Library</h2>
      </div>

      <div className="profile-wl-filters">
        <div className="books-tab-bar books-tab-bar--inline">
          {[
            { value: '', label: 'All' },
            { value: 'movie', label: '🎬 Movies' },
            { value: 'tv_show', label: '📺 TV' },
            { value: 'book', label: '📖 Books' },
          ].map(t => (
            <button key={t.value} className={`books-tab ${wlTypeFilter === t.value ? 'active' : ''}`} onClick={() => setWlTypeFilter(t.value)} type="button">
              {t.label}
            </button>
          ))}
        </div>
        <span className="profile-filter-count">{filteredWatchlist.length} items</span>
      </div>

      {loading ? (
        <div className="loading-state">Loading library...</div>
      ) : filteredWatchlist.length === 0 ? (
        <div className="empty-state">
          <p>Your library is empty.</p>
          <Link to="/movies" className="btn-secondary" style={{ marginTop: '1rem', display: 'inline-block' }}>Browse the catalog</Link>
        </div>
      ) : (
        <div className="profile-watchlist-row">
          {filteredWatchlist.map((item, i) => (
            <LibraryCard
              key={item.id ?? i}
              item={item}
              ratingScore={ratingScores.get(`${item.media_type}:${item.media_id}`) ?? null}
              onUpdate={onWatchlistUpdate}
              onRemove={onWatchlistRemove}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default function Home() {
  const { user, authLoading } = useAuth();
  const location = useLocation();
  const toast = useToast();
  const [watchlistItems, setWatchlistItems] = useState([]);
  const [ratingsItems, setRatingsItems] = useState([]);
  const [continueWatchingItems, setContinueWatchingItems] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);

  const onboardingKey = `onboarding_done_${user?.id || user?.username}`;

  useEffect(() => {
    let cancelled = false;

    if (authLoading || !user) {
      return () => {
        cancelled = true;
      };
    }

    async function fetchStats() {
      setDataLoading(true);
      try {
        const [ratingsResult, watchlistResult, continueWatchingResult] = await Promise.allSettled([
          fetchSupabaseRatings(),
          fetchSupabaseWatchlist(),
          fetchSupabaseContinueWatching(),
        ]);

        if (cancelled) return;

        const ratingsData = ratingsResult.status === 'fulfilled' ? ratingsResult.value : [];
        const watchlistData = watchlistResult.status === 'fulfilled' ? watchlistResult.value : [];
        const continueWatchingData = continueWatchingResult.status === 'fulfilled' ? continueWatchingResult.value : [];
        const nextRatings = Array.isArray(ratingsData) ? ratingsData : [];
        const nextWatchlist = Array.isArray(watchlistData) ? watchlistData : [];
        const nextContinueWatching = Array.isArray(continueWatchingData) ? continueWatchingData : [];
        setWatchlistItems(nextWatchlist);
        setRatingsItems(nextRatings);
        setContinueWatchingItems(nextContinueWatching);
        if (nextRatings.length === 0 && !localStorage.getItem(onboardingKey)) {
          setShowOnboarding(true);
        }
      } catch {
        if (cancelled) return;
        setWatchlistItems([]);
        setRatingsItems([]);
        setContinueWatchingItems([]);
        if (!localStorage.getItem(onboardingKey)) {
          setShowOnboarding(true);
        }
      } finally {
        if (!cancelled) setDataLoading(false);
      }
    }

    fetchStats();

    return () => {
      cancelled = true;
    };
  }, [authLoading, onboardingKey, user]);

  function completeOnboarding() {
    localStorage.setItem(onboardingKey, '1');
    setShowOnboarding(false);
  }

  async function handleRemoveContinueWatching(id) {
    setContinueWatchingItems(prev => prev.filter(item => item.id !== id));
    try {
      await removeSupabaseContinueWatching(id);
    } catch {
      // Re-fetching on next visit will reconcile if the delete failed.
    }
  }

  function handleWatchlistItemUpdate(id, updates) {
    setWatchlistItems(prev => prev.map(item => item.id === id ? {
      ...item,
      ...(updates.status         !== undefined ? { status: updates.status }                  : {}),
      ...(updates.currentSeason  !== undefined ? { current_season: updates.currentSeason }   : {}),
      ...(updates.currentEpisode !== undefined ? { current_episode: updates.currentEpisode } : {}),
      ...(updates.currentChapter !== undefined ? { current_chapter: updates.currentChapter } : {}),
      ...(updates.currentPage    !== undefined ? { current_page: updates.currentPage }       : {}),
    } : item));
  }

  async function handleWatchlistItemRemove(item) {
    try {
      await removeSupabaseWatchlistItem(item.id);
      setWatchlistItems(prev => prev.filter(i => i.id !== item.id));
      toast(`Removed "${item.title}" from your library`);
    } catch (err) {
      toast(err.message || 'Could not remove item', 'error');
    }
  }

  // Bottom-nav "For You" tab links to /home#for-you — scroll it into view
  // once the section has actually mounted (gated behind authLoading below).
  useEffect(() => {
    if (location.hash !== '#for-you' || authLoading || !user) return;
    document.getElementById('for-you')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [location.hash, authLoading, user]);

  return (
    <>
    {showOnboarding && <Onboarding onComplete={completeOnboarding} />}
    <div className="app-layout">
      <Navbar />
      <main className="page-content">
        {(authLoading || !user) ? (
          <div className="loading-state">Loading dashboard...</div>
        ) : (
        <>
        <StreamHero user={user} continueWatchingItems={continueWatchingItems} watchlistItems={watchlistItems} />

        <div className="home-sections">
          <DashboardLibrarySection
            user={user}
            watchlist={watchlistItems}
            ratings={ratingsItems}
            loading={dataLoading}
            onWatchlistUpdate={handleWatchlistItemUpdate}
            onWatchlistRemove={handleWatchlistItemRemove}
          />

          <ForYouSection ready={!authLoading && !!user} />

          <ContinueWatching items={continueWatchingItems} onRemove={handleRemoveContinueWatching} />
        </div>
        </>
        )}
      </main>
    </div>
    </>
  );
}
