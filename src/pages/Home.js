import LoadingBar from '../components/LoadingBar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { FilmSlate, Info, MonitorPlay, X } from '@phosphor-icons/react';
import Navbar from '../components/Navbar';
import PullToRefresh from '../components/PullToRefresh';
import BrowseHero from '../components/BrowseHero';
import TitleRow from '../components/TitleRow';
import TitleCard, { titleUrl } from '../components/TitleCard';
import { computeStarRating } from '../components/RatingArtifact';
import UserAvatar from '../components/UserAvatar';
import ProfileAvatar from '../components/ProfileAvatar';
import { useAuth } from '../contexts/AuthContext';
import {
  fetchSupabaseRatings,
  fetchSupabaseWatchlist,
  fetchSupabaseContinueWatching,
  fetchWatchedAmong,
  removeSupabaseContinueWatching,
} from '../utils/supabaseData';
import { generateSupabaseTypeRecommendations } from '../utils/recommendations';
import { buildPersonalizedRows } from '../utils/personalization';
import { loadRowItems, orderRowsForTaste, rowsFor } from '../utils/browseRows';
import { isChildLevel, maturityRestriction } from '../utils/kidsMode';
import { resumeUrl, detailsUrl, computeProgressBadge, computeResumeProgress, formatTimeLeft, hasSavedPosition, lastAiredEpisode } from '../utils/continueWatching';
import { excludeRated, computeWatchMinutes, countCompleted } from '../utils/libraryStats';
import { getCached, setCached, buildUserDataCacheKey } from '../utils/sessionCache';
import { readKept, writeKept } from '../utils/keptCache';
import { tmdbGet, tmdbIdFromItem, tmdbImage, tmdbKind } from '../utils/tmdb';
import { findNewEpisodes } from '../utils/newEpisodes';
import { seasonStatus } from '../utils/seasonStatus';
import { precacheUpNext } from '../utils/smartPrecache';
import { pickSurprise, surpriseKey, surprisePool } from '../utils/surprise';
import { loadWatchedKeys, titleKey, useWatchedKeys, withoutWatched } from '../utils/watchedTitles';
import { haptic } from '../utils/haptics';
import { isRemovalPending, removeWithUndo } from '../components/UndoToast';
import { fetchSharedWithMe, markSharesSeen } from '../utils/profileShares';
import { enableNewEpisodeAlerts, isSubscribed, pushSupported } from '../utils/pushNotifications';
import { Bell, BellRinging } from '@phosphor-icons/react';

// Library/continue-watching rows carry media_id; cards key off id.
function asTitle(record) {
  return {
    ...record,
    id: record.media_id,
    poster_url: record.poster_url || record.image_url,
  };
}

// Continue Watching has no backdrop art of its own — fetch TMDB's so the
// hero gets a proper wide image instead of a stretched poster.
async function withBackdrop(item) {
  const tmdbId = tmdbIdFromItem(item);
  if (!tmdbId || item.media_type === 'book') return item;
  const details = await tmdbGet(`/${tmdbKind(item.media_type)}/${tmdbId}`);
  return details?.backdrop_path
    ? { ...item, backdrop_url: tmdbImage(details.backdrop_path, 'w1280'), overview: details.overview || item.overview }
    : item;
}

// Opt-in for push alerts when a show in your list gets a new episode.
function NotifyButton() {
  const [state, setState] = useState('idle'); // idle | on | busy | error
  const [message, setMessage] = useState('');
  useEffect(() => {
    let cancelled = false;
    isSubscribed().then((on) => { if (!cancelled && on) setState('on'); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  if (!pushSupported()) return null;
  if (state === 'on') {
    return <span className="st-notify st-notify--on"><BellRinging size={16} weight="fill" /> Alerts on</span>;
  }
  return (
    <span className="st-notify-wrap">
      <button
        type="button"
        className="st-btn st-btn--ghost st-notify"
        disabled={state === 'busy'}
        onClick={async () => {
          setState('busy');
          try { await enableNewEpisodeAlerts(); setState('on'); } catch (error) { setState('error'); setMessage(error.message); }
        }}
      >
        <Bell size={16} weight="bold" /> {state === 'busy' ? 'Turning on…' : 'Get notified'}
      </button>
      {state === 'error' && <span className="st-notify-error" role="status">{message}</span>}
    </span>
  );
}

function ContinueWatchingCard({ item, onRemove, priority, note }) {
  const location = useLocation();
  const episodeLabel = computeProgressBadge(item);
  const resume = computeResumeProgress(item);
  const subtitle = [item.media_type === 'tv_show' ? episodeLabel : null, resume ? formatTimeLeft(resume.secondsLeft) : null]
    .filter(Boolean).join(' · ');
  // The card itself plays straight from the saved position and server;
  // details live behind the (i) button.
  return (
    <div className="st-cw-cell">
      <TitleCard
        item={{
          ...asTitle(item),
          _progress: resume ? Math.max(0.03, resume.fraction) : null,
          _subtitle: subtitle || episodeLabel,
          _note: note,
          _match: null,
        }}
        to={resumeUrl(item)}
        priority={priority}
        showMatch={false}
        playNow
      />
      <Link
        to={detailsUrl(item)}
        state={{ backgroundLocation: location }}
        className="st-cw-info"
        title="Episodes & info"
        aria-label={`Details for ${item.title}`}
      >
        <Info size={15} weight="bold" />
      </Link>
      <button
        type="button"
        className="st-cw-remove"
        title="Remove from Continue Watching"
        aria-label={`Remove ${item.title} from Continue Watching`}
        onClick={(event) => { event.preventDefault(); onRemove(item.id); }}
      >
        <X size={14} weight="bold" />
      </button>
    </div>
  );
}

// Home's mixed (movies + series) taste rows: the first two language/genre
// rows this profile leans toward for each type.
function tasteRowDefinitions(taste, kidsSafe) {
  if (isChildLevel(kidsSafe)) return [];
  const pick = (mediaType) => orderRowsForTaste(rowsFor(mediaType), taste)
    .filter((definition) => definition.kind)
    .slice(0, 2)
    .map((definition) => ({ ...definition, mediaType }));
  return [...pick('tv_show'), ...pick('movie')];
}

async function loadBookPicks() {
  const result = await generateSupabaseTypeRecommendations('book');
  return (result.recommendations || []).map((rec) => ({
    id: rec.id,
    title: rec.title,
    media_type: 'book',
    year: rec.year,
    genre: rec.genre,
    poster_url: rec.posterUrl,
    _reason: rec.reason,
  }));
}

function ProfileStatsHeader({ user, activeProfile, watchlist, ratings }) {
  const stats = useMemo(() => {
    // Rated titles move to Ratings & Reviews, so in-progress (a library-only
    // status) is measured against the watchlist minus anything already rated.
    const libraryWatchlist = excludeRated(watchlist, ratings);
    const completed  = countCompleted(watchlist, ratings);
    const inProgress = libraryWatchlist.filter(i => i.status === 'watching' || i.status === 'reading').length;

    const scores = ratings.map(r => computeStarRating(r.media_type, r)).filter(s => s != null);
    const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : '—';

    // Watch time counts both watchlist progress and rated titles (a rating
    // means it was watched, even if never marked "watched" in the library).
    const minutes = computeWatchMinutes(watchlist, ratings);

    return { completed, inProgress, avg, minutes, totalRatings: ratings.length };
  }, [watchlist, ratings]);

  const hours = Math.round(stats.minutes / 60);
  const editTo = activeProfile && !activeProfile.is_default ? '/profiles' : '/account-settings';
  const tiles = [
    { label: 'Watched', value: hours >= 2 ? `${hours.toLocaleString()}h` : `${stats.minutes}m` },
    { label: 'Completed', value: stats.completed },
    { label: 'In progress', value: stats.inProgress },
    { label: 'Ratings', value: stats.totalRatings },
    { label: 'Avg score', value: stats.avg },
  ];

  // Same look as the Profile page header (pf-*), condensed for Home.
  return (
    <section className="hm-me" aria-label="Your stats">
      <Link to="/profile" className="hm-me-id">
        {activeProfile ? (
          <ProfileAvatar profile={activeProfile} size={56} />
        ) : (
          <UserAvatar avatarUrl={user.avatarUrl} name={user.username} size="lg" />
        )}
        <span className="hm-me-text">
          <span className="hm-me-name">{activeProfile?.name || user.username}</span>
        </span>
      </Link>
      <dl className="pf-stats hm-me-stats">
        {tiles.map((tile) => (
          <div key={tile.label}><dt>{tile.label}</dt><dd>{tile.value}</dd></div>
        ))}
      </dl>
      <Link to={editTo} className="st-btn st-btn--ghost hm-me-edit">
        {activeProfile && !activeProfile.is_default ? 'Manage profiles' : 'Edit profile'}
      </Link>
    </section>
  );
}

// "Surprise me with a movie" / "… a series": opens one of your picks of that
// type, above Continue Watching, in the title popup's Trailer-button style.
// personal === null means the picks are still loading.
const SURPRISES = [
  { mediaType: 'movie', label: 'Surprise me with a movie', Icon: FilmSlate },
  { mediaType: 'tv_show', label: 'Surprise me with a series', Icon: MonitorPlay },
];

function SurpriseButtons({ personal, fallback }) {
  const navigate = useNavigate();
  const location = useLocation();
  const recent = useRef([]);
  const watched = useWatchedKeys();
  const pools = useMemo(
    () => Object.fromEntries(SURPRISES.map(({ mediaType }) => [mediaType, watched ? surprisePool(personal, fallback, { mediaType, exclude: watched }) : []])),
    [personal, fallback, watched],
  );
  // Loaded and nothing to offer of a type: that button goes.
  const shown = SURPRISES.filter(({ mediaType }) => !personal || !watched || pools[mediaType].length > 0);
  if (!shown.length) return null;

  function surprise(mediaType) {
    const item = pickSurprise(pools[mediaType], recent.current);
    if (!item) return;
    recent.current = [surpriseKey(item), ...recent.current].slice(0, 6);
    haptic();
    navigate(titleUrl(item), { state: { backgroundLocation: location } });
  }

  return (
    <div className="st-surprise">
      {shown.map(({ mediaType, label, Icon }) => (
        <button
          key={mediaType}
          type="button"
          className="st-btn td-resume-control td-play--compact"
          onClick={() => surprise(mediaType)}
          disabled={!pools[mediaType].length}
        >
          <Icon size={18} weight="bold" aria-hidden="true" /> {label}
        </button>
      ))}
    </div>
  );
}

export default function Home() {
  const { user, authLoading, activeProfile, profilesLoading, profiles } = useAuth();
  const location = useLocation();
  const [watchlistItems, setWatchlistItems] = useState([]);
  const [ratingsItems, setRatingsItems] = useState([]);
  const [continueWatchingItems, setContinueWatchingItems] = useState([]);
  // "2 episodes left in Season 3" / "New season Friday" per show in
  // Continue Watching (TMDB details are cached for 30 minutes). The same
  // details find finished shows: the newest aired episode is marked watched
  // and nothing is saved partway through, so the show leaves Continue
  // Watching (it comes back when a new episode airs).
  const [seasonNotes, setSeasonNotes] = useState({});
  const [finishedShows, setFinishedShows] = useState(() => new Set());
  useEffect(() => {
    let cancelled = false;
    const shows = continueWatchingItems.filter((item) => item.media_type === 'tv_show').slice(0, 24);
    Promise.all(shows.map(async (item) => {
      const tmdbId = tmdbIdFromItem(item);
      if (!tmdbId) return null;
      const details = await tmdbGet(`/tv/${tmdbId}`).catch(() => null);
      const note = seasonStatus(details, Number(item.current_season) || 1, Number(item.current_episode) || 1);
      return { item, key: `tv_show:${item.media_id ?? item.id}`, note, last: lastAiredEpisode(details) };
    })).then(async (entries) => {
      const found = entries.filter(Boolean);
      if (cancelled) return;
      setSeasonNotes(Object.fromEntries(found.filter((entry) => entry.note).map((entry) => [entry.key, entry.note])));
      const candidates = found.filter((entry) => entry.last && !hasSavedPosition(entry.item));
      const watched = candidates.length
        ? await fetchWatchedAmong(candidates.map(({ item, last }) => ({ mediaId: item.media_id, ...last }))).catch(() => new Set())
        : new Set();
      if (cancelled) return;
      const finished = candidates
        .filter(({ item, last }) => watched.has(`${Number(item.media_id)}:${last.season}:${last.episode}`))
        .map((entry) => entry.key);
      // Only a real change re-renders (the spotlight rebuilds from this list).
      setFinishedShows((current) => (finished.length === current.size && finished.every((key) => current.has(key)) ? current : new Set(finished)));
    });
    return () => { cancelled = true; };
  }, [continueWatchingItems]);
  // What the Continue Watching row and the spotlight show. New Episodes and
  // the calendar keep using the full list.
  const visibleContinueWatching = useMemo(
    () => continueWatchingItems.filter((item) => !finishedShows.has(`${item.media_type}:${item.media_id ?? item.id}`)),
    [continueWatchingItems, finishedShows],
  );

  // Smart downloads: warm the next episodes' pages/art while idle.
  useEffect(() => { precacheUpNext(visibleContinueWatching); }, [visibleContinueWatching]);
  const jumpToContinue = new URLSearchParams(location.search).get('jump') === 'continue';
  const [dataLoading, setDataLoading] = useState(true);
  const [personal, setPersonal] = useState(null);
  const [heroItems, setHeroItems] = useState(null); // null = still loading
  const [refreshKey, setRefreshKey] = useState(0);
  const [newEpisodes, setNewEpisodes] = useState([]);

  const userId = user?.id;

  // Titles other profiles on the account sent to this one.
  const [shared, setShared] = useState([]);
  useEffect(() => {
    if (!userId || profilesLoading) return undefined;
    let cancelled = false;
    fetchSharedWithMe(profiles || []).then((items) => {
      if (cancelled) return;
      setShared(items);
      const unseen = items.filter((item) => item._badge).map((item) => item._shareId);
      // Seen once they've been on screen a moment ("New" stays this visit).
      if (unseen.length) setTimeout(() => markSharesSeen(unseen).catch(() => {}), 4000);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [userId, profilesLoading, profiles, refreshKey]);

  const kidsSafe = maturityRestriction(activeProfile);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const profileId = activeProfile?.id || null;

  // Stale-while-revalidate: the mount effect below hydrates instantly from
  // cache when there's a hit, but this always does the real fetch and
  // re-caches, so data self-heals within a session.
  const fetchStats = useCallback(async () => {
    const cacheKey = buildUserDataCacheKey('home-stats', userId, profileId);
    if (!getCached(cacheKey)) setDataLoading(true);
    try {
      const [ratingsResult, watchlistResult, continueWatchingResult] = await Promise.allSettled([
        fetchSupabaseRatings(),
        fetchSupabaseWatchlist(),
        fetchSupabaseContinueWatching(),
      ]);

      if (!mountedRef.current) return;

      const pick = (result) => (result.status === 'fulfilled' && Array.isArray(result.value) ? result.value : []);
      const nextRatings = pick(ratingsResult);
      const nextWatchlist = pick(watchlistResult);
      const nextContinueWatching = pick(continueWatchingResult).filter((item) => !isRemovalPending(`continue:${item.id}`));
      setWatchlistItems(nextWatchlist);
      setRatingsItems(nextRatings);
      setContinueWatchingItems(nextContinueWatching);
      const snapshot = {
        watchlistItems: nextWatchlist,
        ratingsItems: nextRatings,
        continueWatchingItems: nextContinueWatching,
      };
      setCached(cacheKey, snapshot);
      writeKept(cacheKey, snapshot); // the next visit paints from it
    } catch {
      if (!mountedRef.current) return;
      setWatchlistItems([]);
      setRatingsItems([]);
      setContinueWatchingItems([]);
    } finally {
      if (mountedRef.current) setDataLoading(false);
    }
  }, [userId, profileId]);

  useEffect(() => {
    if (authLoading || !userId) return;

    const key = buildUserDataCacheKey('home-stats', userId, profileId);
    // This tab's copy, else the last visit's (kept on this device a week).
    const cached = getCached(key) || readKept(key);
    if (cached) {
      setWatchlistItems(cached.watchlistItems);
      setRatingsItems(cached.ratingsItems);
      setContinueWatchingItems(cached.continueWatchingItems.filter((item) => !isRemovalPending(`continue:${item.id}`)));
      setDataLoading(false);
    }
    fetchStats();
  }, [authLoading, userId, profileId, fetchStats]);

  // Personalized rows (Top Picks, Because you watched...) across both types.
  useEffect(() => {
    if (authLoading || !userId || profilesLoading) return undefined;
    let cancelled = false;
    const keepKey = `personal:home:${userId}:${profileId || ''}:${kidsSafe || 'all'}`;
    setPersonal((current) => current || readKept(keepKey) || null);
    buildPersonalizedRows({ mediaTypes: ['movie', 'tv_show'], kidsSafe, becauseLimit: 4 })
      .then((result) => {
        if (cancelled) return;
        setPersonal(result);
        writeKept(keepKey, result);
      })
      .catch(() => { if (!cancelled) setPersonal({ hasHistory: false, topPicks: [], becauseYouWatched: [], taste: {} }); });
    return () => { cancelled = true; };
  }, [authLoading, userId, profileId, profilesLoading, kidsSafe, refreshKey]);

  // Hero: resume what you were watching first, then your top picks — or
  // trending for a brand-new profile.
  useEffect(() => {
    let cancelled = false;
    async function buildHero() {
      const watchedKeys = await loadWatchedKeys();
      const resume = visibleContinueWatching
        .filter((item) => item.media_type !== 'book')
        .slice(0, 1)
        .map((item) => ({ ...asTitle(item), _playUrl: resumeUrl(item), _playLabel: 'Resume', _reason: computeProgressBadge(item) ? `Continue ${computeProgressBadge(item)}` : 'Continue where you left off' }));
      // A mix that changes every visit: a few of your picks (one per
      // language/genre, chosen at random from the top dozen) and what's
      // trending this week, interleaved.
      const shuffled = (list) => list.map((item) => ({ item, r: Math.random() })).sort((a, b) => a.r - b.r).map(({ item }) => item);
      const seen = new Set();
      const picks = [];
      for (const item of shuffled(withoutWatched(personal?.topPicks || [], watchedKeys).slice(0, 12))) {
        const flavour = `${item.original_language || ''}|${String(item.genre || '').split(',')[0].trim()}`;
        if (seen.has(flavour)) continue;
        seen.add(flavour);
        picks.push(item);
        if (picks.length >= 3) break;
      }
      const trending = personal ? (await Promise.all([
        loadRowItems(rowsFor('tv_show', { kidsSafe })[0], 'tv_show', { kidsSafe }).catch(() => []),
        loadRowItems(rowsFor('movie', { kidsSafe })[0], 'movie', { kidsSafe }).catch(() => []),
      ])).flatMap((list) => shuffled(withoutWatched(list, watchedKeys).slice(0, 8)).slice(0, picks.length ? 1 : 3)) : [];
      const mixed = [];
      const queues = [picks, shuffled(trending)];
      while (queues.some((queue) => queue.length)) queues.forEach((queue) => { if (queue.length) mixed.push(queue.shift()); });
      const withArt = await Promise.all(resume.map(withBackdrop));
      const keys = new Set(withArt.map((item) => `${item.media_type}:${item.id}`));
      if (!cancelled) setHeroItems([...withArt, ...mixed.filter((item) => !keys.has(`${item.media_type}:${item.id}`))]);
    }
    buildHero();
    return () => { cancelled = true; };
  }, [visibleContinueWatching, personal, kidsSafe]);

  // Shows in your list with an episode newer than where you are.
  useEffect(() => {
    if (dataLoading) return undefined;
    let cancelled = false;
    findNewEpisodes({ watchlist: watchlistItems, continueWatching: continueWatchingItems })
      .then((items) => { if (!cancelled) setNewEpisodes(items); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [dataLoading, watchlistItems, continueWatchingItems]);

  async function handleRefresh() {
    setRefreshKey((n) => n + 1);
    await fetchStats();
  }

  // The details overlay that saves a rating is a separately-mounted screen
  // on top of Home, so it broadcasts instead of updating Home's state.
  useEffect(() => {
    function onRatingSaved(event) {
      const { mediaType, mediaId, categories } = event.detail || {};
      if (!mediaType || !Number.isFinite(mediaId)) return;

      setRatingsItems((current) => {
        const next = { ...categories, media_type: mediaType, media_id: mediaId };
        const index = current.findIndex(
          (entry) => entry.media_type === mediaType && entry.media_id === mediaId
        );
        if (index === -1) return [...current, next];
        const updated = [...current];
        updated[index] = { ...updated[index], ...next };
        return updated;
      });
    }

    window.addEventListener('binge:ratingSaved', onRatingSaved);
    return () => window.removeEventListener('binge:ratingSaved', onRatingSaved);
  }, []);

  // Off the row at once; deleted when the Undo popup runs out.
  function handleRemoveContinueWatching(id) {
    const index = continueWatchingItems.findIndex((item) => item.id === id);
    const removed = continueWatchingItems[index];
    if (!removed) return;
    setContinueWatchingItems((prev) => prev.filter((item) => item.id !== id));
    removeWithUndo({
      key: `continue:${id}`,
      message: `Removed “${removed.title || 'that'}” from Continue Watching.`,
      onUndo: () => setContinueWatchingItems((prev) => (prev.some((item) => item.id === id)
        ? prev
        : [...prev.slice(0, index), removed, ...prev.slice(index)])),
      onCommit: () => removeSupabaseContinueWatching(id),
    });
  }

  // The spotlight never recommends something already watched; its Resume
  // slide (from Continue Watching) stays.
  const watched = useWatchedKeys();
  const shownHero = useMemo(
    () => (heroItems && watched ? heroItems.filter((item) => item._playUrl || !watched.has(titleKey(item))) : null),
    [heroItems, watched]
  );

  // "Surprise me" for a profile with no history yet: the spotlight's
  // trending titles (not its Continue Watching slide).
  const surpriseFallback = useMemo(() => (shownHero || []).filter((item) => !item._playUrl), [shownHero]);

  // Bottom-nav "For You" tab links to /home#for-you.
  useEffect(() => {
    if (location.hash !== '#for-you' || authLoading || !userId) return;
    document.getElementById('for-you')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [location.hash, authLoading, userId, personal]);

  const myList = useMemo(
    () => excludeRated(watchlistItems, ratingsItems)
      .filter((item) => item.status !== 'watched' && item.status !== 'read')
      .map((item) => ({ ...asTitle(item), _progressLabel: computeProgressBadge(item) })),
    [watchlistItems, ratingsItems]
  );

  const tasteRows = useMemo(() => tasteRowDefinitions(personal?.taste, kidsSafe), [personal?.taste, kidsSafe]);
  const headlineRows = useMemo(() => ({
    movie: rowsFor('movie', { kidsSafe })[0],
    tv_show: rowsFor('tv_show', { kidsSafe })[0],
    newMovies: rowsFor('movie', { kidsSafe }).find((definition) => definition.id === 'new'),
  }), [kidsSafe]);

  const name = activeProfile?.name || user?.username;

  // Home-screen shortcut "Continue Watching" (manifest) lands here.
  useEffect(() => {
    if (!jumpToContinue || !visibleContinueWatching.length) return;
    const row = document.getElementById('continue-watching');
    row?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    row?.querySelector('.st-card')?.focus({ preventScroll: true });
  }, [jumpToContinue, visibleContinueWatching.length]);

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content st-home">
        <PullToRefresh onRefresh={handleRefresh} disabled={authLoading || !user}>
        {(authLoading || !user) ? (
          <LoadingBar label="Loading dashboard..." />
        ) : (
        <>
        <BrowseHero items={shownHero} kicker={`Welcome back, ${name}`} />

        <div className="st-rows">
          <SurpriseButtons personal={personal} fallback={surpriseFallback} />
          {visibleContinueWatching.length > 0 && (
            <div id="continue-watching" className="st-anchor">
            <TitleRow
              title={`Continue Watching for ${name}`}
              items={visibleContinueWatching}
              eager
              renderItem={(item, index) => (
                <ContinueWatchingCard item={item} onRemove={handleRemoveContinueWatching} priority={index < 6} note={seasonNotes[`${item.media_type}:${item.media_id ?? item.id}`]} />
              )}
            />
            </div>
          )}

          {newEpisodes.length > 0 && (
            <TitleRow
              title="New Episodes"
              subtitle="New in shows you’re watching"
              items={newEpisodes}
              action={<NotifyButton />}
              renderItem={(item) => (
                <TitleCard
                  item={item}
                  to={`/tv-show/${item.id}?play=1&season=${item.current_season}&episode=${item.current_episode}`}
                  showMatch={false}
                />
              )}
            />
          )}

          {shared.length > 0 && (
            <TitleRow title="Sent to you" subtitle="From other profiles on this account" items={shared} />
          )}

          <div id="for-you" />
          {personal?.hasHistory && personal.topPicks.length > 0 && (
            <TitleRow
              title={`Top Picks for ${name}`}
              subtitle="Based on what you watch and how you rate it"
              items={personal.topPicks}
              eager
              hideWatched
            />
          )}
          {personal && !personal.hasHistory && (
            <div className="st-coldstart">
              <p>Rate or watch a few titles and binge. will start building rows just for you — or bring your history from Letterboxd, IMDb, Trakt or Netflix.</p>
              <div className="st-coldstart-actions">
                <Link className="st-btn st-btn--primary" to="/import">Import my history</Link>
                <Link className="st-btn st-btn--ghost" to="/movies">Find something to watch</Link>
              </div>
            </div>
          )}

          {personal?.becauseYouWatched?.[0] && (
            <TitleRow title={personal.becauseYouWatched[0].title} items={personal.becauseYouWatched[0].items} hideWatched />
          )}

          <TitleRow
            key={`top10-tv-${refreshKey}`}
            title={isChildLevel(kidsSafe) ? 'Popular Kids Series' : 'Top 10 Series This Week'}
            ranked={!isChildLevel(kidsSafe)}
            load={() => loadRowItems(headlineRows.tv_show, 'tv_show', { kidsSafe })}
            keepKey={`row:home-top10-tv:${kidsSafe || 'all'}`}
            limit={isChildLevel(kidsSafe) ? 30 : 10}
            hideWatched
          />

          {myList.length > 0 && <TitleRow title="My List" items={myList} />}

          {personal?.becauseYouWatched?.slice(1, 3).map((row) => (
            <TitleRow key={row.id} title={row.title} items={row.items} hideWatched />
          ))}

          <TitleRow
            key={`top10-movie-${refreshKey}`}
            title={isChildLevel(kidsSafe) ? 'Popular Kids Movies' : 'Top 10 Movies This Week'}
            ranked={!isChildLevel(kidsSafe)}
            load={() => loadRowItems(headlineRows.movie, 'movie', { kidsSafe })}
            keepKey={`row:home-top10-movie:${kidsSafe || 'all'}`}
            limit={isChildLevel(kidsSafe) ? 30 : 10}
            hideWatched
          />

          {tasteRows.map((definition) => (
            <TitleRow
              key={`${definition.mediaType}-${definition.id}-${refreshKey}`}
              title={definition.title}
              load={() => loadRowItems(definition, definition.mediaType, { kidsSafe })}
              minItems={5}
              hideWatched
            />
          ))}

          {personal?.becauseYouWatched?.slice(3).map((row) => (
            <TitleRow key={row.id} title={row.title} items={row.items} hideWatched />
          ))}

          {headlineRows.newMovies && (
            <TitleRow
              key={`new-movies-${refreshKey}`}
              title="New Movies"
              load={() => loadRowItems(headlineRows.newMovies, 'movie', { kidsSafe })}
              minItems={5}
              hideWatched
            />
          )}

          {!kidsSafe && (
            <TitleRow key={`books-${refreshKey}`} title="Books for You" load={loadBookPicks} minItems={3} />
          )}
        </div>

        <div className="home-sections st-home-stats">
          <ProfileStatsHeader user={user} activeProfile={activeProfile} watchlist={watchlistItems} ratings={ratingsItems} />
          {dataLoading && <LoadingBar label="Loading your library…" />}
        </div>
        </>
        )}
        </PullToRefresh>
      </main>
    </div>
  );
}
