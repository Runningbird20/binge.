import { useEffect, useState } from 'react';
import { EVENT_PROVIDERS, FAILOVER_SECONDS } from '../../utils/embedProviders';
import { SANDBOX_CHECK_SECONDS, SANDBOX_FLAGS, forgetRefusal, popupsBlocked, rememberRefusal } from '../../utils/popupSandbox';

// Whether this load of the server's player is sandboxed (pop-ups blocked;
// see utils/popupSandbox.js). A sandboxed load of a server that reports
// playback, with no playback after SANDBOX_CHECK_SECONDS, reloads the same
// server unsandboxed; if that one plays, the server is remembered as
// refusing the sandbox. This never changes the server, so it applies to
// hand-picked servers too. Call it after usePlaybackMessages (it reads the
// playbackRef that hook resets for each load).
export default function usePopupSandbox({ provider, itemId, season, episode, playbackRef }) {
  const key = `${provider}|${itemId}|${season}|${episode}`;
  const [unsandboxedKey, setUnsandboxedKey] = useState(null);
  const retried = unsandboxedKey === key;
  const sandboxed = !retried && popupsBlocked(provider);

  useEffect(() => {
    if (!EVENT_PROVIDERS.has(provider) || (!sandboxed && !retried)) return undefined;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const seen = playbackRef.current.time > 0;
      const elapsed = (Date.now() - startedAt) / 1000;
      if (sandboxed) {
        if (seen) { forgetRefusal(provider); clearInterval(timer); return; }
        if (elapsed >= SANDBOX_CHECK_SECONDS) { clearInterval(timer); setUnsandboxedKey(key); }
        return;
      }
      // The unsandboxed retry: playing now means the sandbox was the problem.
      if (seen) { rememberRefusal(provider); clearInterval(timer); return; }
      if (elapsed >= FAILOVER_SECONDS) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
    // One check per load (key) and sandbox state; playbackRef is a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, sandboxed, retried]);

  return { sandboxed, sandbox: sandboxed ? SANDBOX_FLAGS : undefined };
}
