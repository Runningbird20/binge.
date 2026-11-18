import LoadingBar from '../components/LoadingBar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Navbar from '../components/Navbar';
import PullToRefresh from '../components/PullToRefresh';
import BrowseHero from '../components/BrowseHero';
import TitleRow from '../components/TitleRow';
import TitleCard from '../components/TitleCard';
import { isRemovalPending, removeWithUndo } from '../components/UndoToast';
import ContinueWatchingCard from '../components/home/ContinueWatchingCard';
import NotifyButton from '../components/home/NotifyButton';
import ProfileStatsHeader from '../components/home/ProfileStatsHeader';
import SurpriseButtons from '../components/home/SurpriseButtons';
import useContinueWatchingNotes from '../components/home/useContinueWatchingNotes';
import useHomeSpotlight from '../components/home/useHomeSpotlight';
import { asTitle } from '../components/home/asTitle';
import { useAuth } from '../contexts/AuthContext';
import {
  fetchSupabaseRatings,
  fetchSupabaseWatchlist,
  fetchSupabaseContinueWatching,
  removeSupabaseContinueWatching,
} from '../utils/supabaseData';
import { buildPersonalizedRows } from '../utils/personalization';
import { loadRowItems, orderRowsForTaste, rowsFor } from '../utils/browseRows';
import { isChildLevel, maturityRestriction } from '../utils/kidsMode';
import { computeProgressBadge } from '../utils/continueWatching';
import { excludeRated } from '../utils/libraryStats';
import { getCached, setCached, buildUserDataCacheKey } from '../utils/sessionCache';
import { readKept, writeKept } from '../utils/keptCache';
import { findNewEpisodes } from '../utils/newEpisodes';
import { precacheUpNext } from '../utils/smartPrecache';
import { titleKey, useWatchedKeys } from '../utils/watchedTitles';
import { fetchSharedWithMe, markSharesSeen } from '../utils/profileShares';

// Home: the spotlight, then Surprise me, Continue Watching, New Episodes and
// the personal and Top 10 rows, then the profile's stats. Its parts are in
// components/home/.

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

export default function Home() {
  const { user, authLoading, activeProfile, profilesLoading, profiles } = useAuth();
  const location = useLocation();
  const [watchlistItems, setWatchlistItems] = useState([]);
  const [ratingsItems, setRatingsItems] = useState([]);
  const [continueWatchingItems, setContinueWatchingItems] = useState([]);
  // Season notes, and finished shows left out of the row and the spotlight.
  const { seasonNotes, visibleContinueWatching } = useContinueWatchingNotes(continueWatchingItems);

  // Smart downloads: warm the next episodes' pages/art while idle.
  useEffect(() => { precacheUpNext(visibleContinueWatching); }, [visibleContinueWatching]);
  const jumpToContinue = new URLSearchParams(location.search).get('jump') === 'continue';
  const [dataLoading, setDataLoading] = useState(true);
  const [personal, setPersonal] = useState(null);
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

  // The spotlight: Resume first, then your picks mixed with trending.
  const heroItems = useHomeSpotlight(visibleContinueWatching, personal, kidsSafe);

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
