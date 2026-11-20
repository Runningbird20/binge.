import { useEffect } from 'react';
import { pickVidriftSubtitle } from '../../utils/foreignCaptions';
import { languageName } from '../../utils/tmdb';

const ORIGIN = 'https://embed.vidrift.net';

// VidRift starts with subtitles off. For a title in another language, turn
// on its track for the caption language once its list has one (the list
// fills in while the stream loads, and a set sent before the video is ready
// doesn't stick, so it's re-sent on later states, a few times at most).
// Stops once captions are on, ours or any the viewer picked, and never turns
// them back on after the viewer has turned them off.
export default function useVidriftCaptions({ iframeRef, active, lang, loadKey }) {
  useEffect(() => {
    if (!active || !lang) return undefined;
    let done = false;
    let sent = 0;
    let turnedOn = false;
    const frame = () => iframeRef.current?.contentWindow;
    const onMessage = (event) => {
      if (done || event.origin !== ORIGIN || event.source !== frame()) return;
      const data = event.data;
      if (!data || data.type !== 'vidrift:state') return;
      const current = data.subtitle || 'off';
      if (current !== 'off') { turnedOn = true; return; } // on: leave it be
      if (turnedOn) { done = true; return; } // was on, now off: the viewer's choice
      const value = pickVidriftSubtitle(data.subtitles, lang, languageName(lang));
      if (!value || sent >= 6) return;
      sent += 1;
      frame()?.postMessage({ type: 'vidrift:set', subtitle: value }, ORIGIN);
    };
    window.addEventListener('message', onMessage);
    // vidrift:get-state subscribes to every later change; asked again in
    // case the first ask came before the player was listening.
    const timers = [1500, 5000, 12000].map((ms) => setTimeout(() => frame()?.postMessage({ type: 'vidrift:get-state' }, ORIGIN), ms));
    return () => { window.removeEventListener('message', onMessage); timers.forEach(clearTimeout); };
  }, [active, lang, loadKey, iframeRef]);
}
