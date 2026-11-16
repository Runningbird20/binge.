import { useCallback, useEffect, useRef, useState } from 'react';
import { inBingeApp, newBridgeNonce, parseVtt, sendToFrame } from '../../utils/frameBridge';
import { RESUMABLE } from '../../utils/embedProviders';
import { isSupabaseConfigured, supabase } from '../../utils/supabase';
import { getActiveProfileId } from '../../utils/activeProfile';

const CAPTIONS_KEY = 'binge:appCaptions';
const SYNC_KEY = 'binge:subtitleSync';

function readJson(key, fallback) {
  try { return JSON.parse(window.localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function writeJson(key, value) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked */ }
}

// Inside the phone apps only (utils/frameBridge.js): every server reports its
// real time (so resume, intro skipping and Up Next work on all of them),
// jumps to the saved second on servers that can't start there themselves,
// and can show binge.'s own captions (OpenSubtitles, the TV apps' files)
// with the timing fix that's remembered and shared (subtitle_sync).
export default function useAppBridge({ iframeRef, provider, loadKey, item, mediaType, season, episode, subtitles, startAt, playbackRef }) {
  const enabled = inBingeApp();
  const nonceRef = useRef('');
  const [active, setActive] = useState(false);
  const seekedRef = useRef('');

  // A new nonce per frame load; say hello until the frame answers (and now
  // and then after, for nested frames that load later).
  useEffect(() => {
    if (!enabled) return undefined;
    nonceRef.current = newBridgeNonce();
    setActive(false);
    const hello = () => sendToFrame(iframeRef.current, { cmd: 'hello', nonce: nonceRef.current });
    hello();
    const timer = setInterval(hello, 2000);
    return () => clearInterval(timer);
  }, [enabled, loadKey, iframeRef]);

  // Called by usePlaybackMessages with each bridged reading.
  const noteReading = useCallback((reading) => {
    if (!active) setActive(true);
    // Servers that can't start at a second themselves: jump once it plays.
    if (startAt > 30 && !RESUMABLE.has(provider) && seekedRef.current !== loadKey && reading.time > 0 && reading.time < startAt - 10) {
      seekedRef.current = loadKey;
      sendToFrame(iframeRef.current, { cmd: 'seek', t: startAt });
    }
  }, [active, startAt, provider, loadKey, iframeRef]);

  const seek = useCallback((t) => sendToFrame(iframeRef.current, { cmd: 'seek', t }), [iframeRef]);

  // ── binge.'s captions in the server's frame ───────────────────────────
  const [captionsOn, setCaptionsOn] = useState(() => enabled && readJson(CAPTIONS_KEY, false));
  const [file, setFile] = useState(null); // { cues, release, versions, version }
  const [version, setVersion] = useState(0);
  const [shift, setShift] = useState(0);
  const lang = subtitles && subtitles !== 'off' ? subtitles : 'en';
  const syncKey = file && item?.id
    ? `${mediaType}:${item.id}:${season || 0}:${episode || 0}:${lang}:${provider}:${file.release || `version-${file.version}`}`
    : null;
  const pendingReportRef = useRef(null);

  useEffect(() => { setVersion(0); }, [item?.id, season, episode, lang]);

  useEffect(() => {
    setFile(null);
    if (!enabled || !captionsOn || !item?.source_key) return undefined;
    const match = /^tmdb:(movie|tv):(\d+)$/.exec(item.source_key);
    if (!match) return undefined;
    let cancelled = false;
    const params = new URLSearchParams({ type: match[1], tmdb: match[2], lang, version: String(version) });
    if (match[1] === 'tv') { params.set('season', String(season || 1)); params.set('episode', String(episode || 1)); }
    fetch(`/api/extras/subtitles?${params}`).then((res) => res.json()).then((data) => {
      if (cancelled || !data?.vtt) return;
      setFile({ cues: parseVtt(data.vtt), release: data.release || '', versions: data.versions || 1, version });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [enabled, captionsOn, item?.source_key, season, episode, lang, version]);

  // Where to start: your shift for this file and server, else the viewers' median.
  useEffect(() => {
    setShift(0);
    if (!syncKey) return undefined;
    const mine = readJson(SYNC_KEY, {})[syncKey];
    if (typeof mine === 'number') { setShift(mine); return undefined; }
    if (!isSupabaseConfigured || !supabase) return undefined;
    let cancelled = false;
    supabase.rpc('subtitle_sync_summary', {
      p_media_type: mediaType, p_media_id: item.id, p_season: season || 0, p_episode: episode || 0,
      p_lang: lang, p_release: file.release || `version-${file.version}`, p_server: provider,
    }).then(({ data }) => {
      const value = Number(data?.[0]?.offset_s);
      if (!cancelled && Number.isFinite(value)) setShift(Math.round(value * 10) / 10);
    });
    return () => { cancelled = true; };
    // file is captured through syncKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncKey]);

  // Send the cues (and the shift) to the frame; again whenever it reloads.
  useEffect(() => {
    if (!enabled || !active) return;
    if (captionsOn && file) sendToFrame(iframeRef.current, { cmd: 'captions', cues: file.cues.map((c) => [c.start, c.end, c.text]), shift });
    else sendToFrame(iframeRef.current, { cmd: 'captions', cues: null });
  }, [enabled, active, captionsOn, file, iframeRef, loadKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (enabled && active && file) sendToFrame(iframeRef.current, { cmd: 'shift', shift });
  }, [enabled, active, file, shift, iframeRef]);

  // A shift left alone for 20s of playing is shared with other viewers.
  useEffect(() => {
    const timer = setInterval(() => {
      const pending = pendingReportRef.current;
      if (!pending || Date.now() - pending.at < 20000 || !playbackRef.current?.playing) return;
      pendingReportRef.current = null;
      if (!isSupabaseConfigured || !supabase) return;
      supabase.auth.getUser().then(({ data }) => {
        const userId = data?.user?.id;
        if (!userId) return;
        supabase.from('subtitle_sync').upsert({
          user_id: userId, media_type: mediaType, media_id: item.id, season: season || 0, episode: episode || 0,
          lang, release: (pending.release || '').slice(0, 300), server: provider, offset_s: pending.shift,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,media_type,media_id,season,episode,lang,release,server' }).then(() => {});
      });
    }, 5000);
    return () => clearInterval(timer);
  }, [playbackRef, mediaType, item?.id, season, episode, lang, provider]);

  const nudge = useCallback((by) => {
    setShift((current) => {
      const next = Math.round(Math.max(-30, Math.min(30, current + by)) * 10) / 10;
      if (syncKey) {
        writeJson(SYNC_KEY, { ...readJson(SYNC_KEY, {}), [syncKey]: next });
        pendingReportRef.current = { at: Date.now(), shift: next, release: file?.release || `version-${file?.version}` };
      }
      return next;
    });
  }, [syncKey, file]);

  const toggleCaptions = useCallback(() => {
    setCaptionsOn((on) => { writeJson(CAPTIONS_KEY, !on); return !on; });
  }, []);

  return {
    enabled,
    active,
    nonceRef,
    noteReading,
    seek,
    captions: enabled ? {
      on: captionsOn,
      toggle: toggleCaptions,
      loaded: Boolean(file),
      release: file?.release || '',
      shift,
      nudge,
      reset: () => nudge(-shift),
      nextVersion: file && file.versions > 1 ? () => setVersion((v) => (v + 1) % Math.min(file.versions, 10)) : null,
      profile: getActiveProfileId(),
    } : null,
  };
}
