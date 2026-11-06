import { useEffect, useRef } from 'react';
import { readServerEpisode } from '../../utils/playbackMessages';

// After a switch, the old episode's last progress messages are ignored for a
// while, so they can't flip the site back.
const SETTLE_MS = 10000;

// Episode changes made inside the server's own player. VidRift posts
// vidrift:episode just before it switches (its Next button, its Episodes menu,
// its own Up Next), and every VidRift message names the episode playing, which
// also catches a switch whose message was missed. onEpisode gets
// { season, episode } whenever that differs from the episode the site tracks.
export default function useServerEpisode({ isTV, tmdbId, season, episode, iframeRef, onEpisode }) {
  const latest = useRef({ season, episode, onEpisode });
  latest.current = { season, episode, onEpisode };
  const switchedAtRef = useRef(0);

  useEffect(() => {
    if (!isTV) return undefined;
    function onMessage(event) {
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return;
      const reported = readServerEpisode(event.data, tmdbId);
      if (!reported) return;
      const current = latest.current;
      if (reported.season === current.season && reported.episode === current.episode) return;
      const now = Date.now();
      if (!reported.switching && now - switchedAtRef.current < SETTLE_MS) return;
      switchedAtRef.current = now;
      current.onEpisode({ season: reported.season, episode: reported.episode });
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [isTV, tmdbId, iframeRef]);
}
