import { useEffect, useRef } from 'react';
import { readPlayback } from '../../utils/playbackMessages';
import { positionKey, savePosition } from '../../utils/playbackPositions';
import { EVENT_PROVIDERS } from '../../utils/embedProviders';

// Listens to the playback messages the embed posts (time, duration,
// play/pause/ended; see utils/playbackMessages) and keeps playbackRef current.
// Each reading also confirms the server, feeds intro learning and failover,
// and saves the position locally (every 10s) and for other devices (30s).
export default function usePlaybackMessages({
  provider, item, mediaType, season, episode, iframeRef, playbackRef,
  confirmServer, failover, intro, syncPosition,
}) {
  const lastRemoteSaveRef = useRef(0);

  useEffect(() => {
    if (!EVENT_PROVIDERS.has(provider)) return undefined;
    playbackRef.current = { time: 0, duration: 0, playing: false, ended: false, lastAdvanceAt: Date.now(), lastSavedAt: 0 };
    function onMessage(event) {
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return;
      const reading = readPlayback(event.data);
      if (!reading) return;
      const now = Date.now();
      const state = playbackRef.current;

      if (reading.state === 'pause' || reading.state === 'ended') state.playing = false;
      state.ended = reading.state === 'ended' ? true : (reading.state === 'play' ? false : state.ended);
      if (reading.state === 'play') { state.playing = true; state.lastAdvanceAt = now; }
      if (reading.duration > 0) state.duration = reading.duration;
      failover.noteDuration(state.duration);

      if (Number.isFinite(reading.time) && reading.time > 0) {
        intro.noteTime(state, reading);
        if (Math.abs(reading.time - state.time) > 0.25) {
          state.lastAdvanceAt = now;
          if (reading.state !== 'pause') state.playing = true;
          failover.noteAdvance();
        }
        state.time = reading.time;
        failover.markPlaybackSeen();
        if (reading.time > 3) confirmServer();
        if (now - state.lastSavedAt > 10000 && item?.id) {
          state.lastSavedAt = now;
          savePosition(positionKey(mediaType, item.id, season, episode), reading.time, state.duration);
        }
        // Synced copy (other devices) every 30s once there's something to
        // resume. Upserting Continue Watching also keeps it fresh.
        if (now - lastRemoteSaveRef.current > 30000 && item?.id && reading.time > 30) {
          lastRemoteSaveRef.current = now;
          syncPosition(reading.time, state.duration);
        }
      }
    }
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      const state = playbackRef.current;
      if (item?.id && state.time > 0) {
        savePosition(positionKey(mediaType, item.id, season, episode), state.time, state.duration);
        if (state.time > 30) syncPosition(state.time, state.duration);
      }
    };
    // failover, intro and syncPosition are new objects every render but only use refs,
    // setters and the ids/episode listed here; item?.id is listed so a new title never
    // saves its position under the previous one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, confirmServer, season, episode, item?.id, mediaType]);
}
