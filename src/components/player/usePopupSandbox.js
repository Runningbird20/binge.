import { useEffect, useState } from 'react';
import { EVENT_PROVIDERS, FAILOVER_SECONDS, PROVIDERS } from '../../utils/embedProviders';
import {
  SANDBOX_CHECK_SECONDS, SANDBOX_FLAGS, SANDBOX_PLAY_SECONDS, createPlaybackMeter, forgetRefusal, popupsBlocked, rememberRefusal,
} from '../../utils/popupSandbox';

// Whether this load of the server's player is sandboxed (pop-ups blocked;
// see utils/popupSandbox.js). The sandbox counts as working once the server
// reports SANDBOX_PLAY_SECONDS of playback, not just a time. A sandboxed load
// that reports no time within SANDBOX_CHECK_SECONDS, or doesn't play that long
// within SANDBOX_CHECK_SECONDS of its first time, reloads the same server
// unsandboxed; if that one plays SANDBOX_PLAY_SECONDS, the server is
// remembered as refusing the sandbox. A pause reported after the first time
// (the viewer's) holds the countdown, and so does a clickToStart server
// (VidSpark) that hasn't reported a time yet: it may be waiting for the
// viewer's click, and unsandboxed every such click opens an ad. This never
// changes the server, so it applies to hand-picked servers too. Call it after
// usePlaybackMessages (it reads the playbackRef that hook resets for each
// load). paused: the sleep timer has the player stopped, so there's nothing to
// check until it loads again.
export default function usePopupSandbox({ provider, itemId, season, episode, playbackRef, paused = false }) {
  const key = `${provider}|${itemId}|${season}|${episode}`;
  const [unsandboxedKey, setUnsandboxedKey] = useState(null);
  const retried = unsandboxedKey === key;
  const sandboxed = !retried && popupsBlocked(provider);

  useEffect(() => {
    if (paused || !EVENT_PROVIDERS.has(provider) || (!sandboxed && !retried)) return undefined;
    // The unsandboxed retry is the same server, so playbackRef still holds the
    // sandboxed load's last time; only times reported after it count.
    const read = createPlaybackMeter(playbackRef.current.time);
    const limit = sandboxed ? SANDBOX_CHECK_SECONDS : FAILOVER_SECONDS;
    const waitsForClick = sandboxed && Boolean(PROVIDERS.find((entry) => entry.id === provider)?.clickToStart);
    let started = false;
    let waited = 0;
    const timer = setInterval(() => {
      const state = playbackRef.current;
      const meter = read(state.time, Date.now());
      if (meter.played >= SANDBOX_PLAY_SECONDS) {
        // Sandboxed, it works. Unsandboxed, the sandbox was the problem.
        if (sandboxed) forgetRefusal(provider); else rememberRefusal(provider);
        clearInterval(timer);
        return;
      }
      if (meter.started && !started) { started = true; waited = 0; }
      // Paused after it started, or a clickToStart server not started yet: wait.
      if (started ? !state.playing : waitsForClick) return;
      waited += 1;
      if (waited < limit) return;
      clearInterval(timer);
      if (sandboxed) setUnsandboxedKey(key);
    }, 1000);
    return () => clearInterval(timer);
    // One check per load (key) and sandbox state; playbackRef is a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, key, sandboxed, retried]);

  return { sandboxed, sandbox: sandboxed ? SANDBOX_FLAGS : undefined };
}
