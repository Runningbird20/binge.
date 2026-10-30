import { useEffect } from 'react';
import { upsertSupabaseContinueWatching, updateWatchlistProgress, fetchSupabaseResumePoint } from '../../utils/supabaseData';
import { getResumePosition, mergeRemotePosition, positionKey } from '../../utils/playbackPositions';
import { CONTINUE_WATCHING_DELAY_SECONDS, RESUMABLE, buildUrl } from '../../utils/embedProviders';

// Keeps Continue Watching and the synced playback position (other devices)
// up to date, and jumps to a newer position saved on another device.
export default function usePositionSync({
  item, mediaType, isTV, season, episode, provider, externalId, subtitleLang,
  playbackRef, iframeRef, pendingStartRef, frozenStartRef, setResumeNonce,
}) {
  function syncPosition(seconds, duration) {
    upsertSupabaseContinueWatching({
      mediaType,
      mediaId: item.id,
      ...(isTV ? { currentSeason: season, currentEpisode: episode } : {}),
      positionSeconds: seconds,
      durationSeconds: duration,
    }).catch(() => {});
  }

  // Position from another device: if the synced copy is newer than this
  // device's and the player has barely started, jump there.
  useEffect(() => {
    if (!item?.id) return undefined;
    let cancelled = false;
    fetchSupabaseResumePoint({ mediaType, mediaId: item.id }).then((remote) => {
      if (cancelled || !remote || !(remote.position > 30)) return;
      if (isTV && (Number(remote.season) !== Number(season) || Number(remote.episode) !== Number(episode))) return;
      const key = positionKey(mediaType, item.id, season, episode);
      const adopted = mergeRemotePosition(key, remote.position, remote.duration, remote.updatedAt);
      if (!adopted || playbackRef.current.time > 10) return;
      const target = getResumePosition(key);
      if (!target || Math.abs(target - (frozenStartRef.current.value || 0)) < 30) return;
      if (provider === 'vidrift' && iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage({ type: 'vidrift:resume', currentTime: target }, 'https://embed.vidrift.net');
      } else if (RESUMABLE.has(provider)) {
        pendingStartRef.current = target;
        setResumeNonce((n) => n + 1);
      }
    });
    return () => { cancelled = true; };
    // Once per title/episode; the provider read here is the one this episode opened on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, season, episode]);

  // Recording/updating Continue Watching — independent of whether this title
  // is in the library (adding to the library stays a separate, explicit
  // action). Delayed by CONTINUE_WATCHING_DELAY_SECONDS so a title only lands
  // there once the player has actually stayed open, not on every click that
  // resolves a stream URL — a misclick or quick "let me check this out" close
  // shouldn't create (or bump) a Continue Watching entry.
  useEffect(() => {
    if (!item?.id || !buildUrl(provider, externalId, mediaType, season, episode, subtitleLang)) return undefined;

    const timer = setTimeout(() => {
      const progress = isTV ? { currentSeason: season, currentEpisode: episode } : {};
      upsertSupabaseContinueWatching({ mediaType, mediaId: item.id, ...progress }).catch(() => {});
      // Keeps the watchlist row's own progress columns in sync too, so a
      // title that's in BOTH the library and Continue Watching shows the
      // same up-to-date episode on both surfaces. No-ops if it's not in the
      // library — see updateWatchlistProgress's own doc comment.
      if (isTV) {
        updateWatchlistProgress({ mediaType, mediaId: item.id, ...progress }).catch(() => {});
      }
    }, CONTINUE_WATCHING_DELAY_SECONDS * 1000);

    return () => clearTimeout(timer);
  }, [item?.id, mediaType, isTV, season, episode, provider, externalId, subtitleLang]);

  return { syncPosition };
}
