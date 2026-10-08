// Audio / subtitle preferences and smart server choice for the video player.
//
// The embed servers are cross-origin iframes: nothing in the page can read
// which audio track a server is actually playing or whether it loaded a
// real video. So "pick the server with Korean audio" is learned instead of
// detected, from three sources (strongest first):
//   1. this profile's own history — the server that last worked for this
//      title (and what audio it had), so episode 2 starts where episode 1
//      ended up;
//   2. other viewers' reports for this title (stream_reports, aggregated by
//      the stream_report_summary RPC — counts only, never who);
//   3. a default order.
// Subtitle language *can* be requested from servers that support it
// (Vidsrc's `ds_lang`), so that preference is passed straight through.
import { supabase, isSupabaseConfigured } from './supabase';
import { getActiveProfileId } from './activeProfile';

const PREFS_KEY = 'binge:playback-prefs:';
const MEMORY_KEY = 'binge:server-memory:';

export const AUDIO_CHOICES = [
  { value: 'original', label: 'Original language' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'hi', label: 'Hindi' },
];

export const SUBTITLE_CHOICES = [
  { value: 'off', label: 'Off' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'de', label: 'German' },
  { value: 'ar', label: 'Arabic' },
];

const DEFAULT_PREFS = { audio: 'original', subtitles: 'en' };

function profileKey(prefix) {
  return `${prefix}${getActiveProfileId() || 'default'}`;
}

function readJson(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode / quota — the in-session choice still applies.
  }
}

export function getPlaybackPrefs() {
  return readJson(profileKey(PREFS_KEY), DEFAULT_PREFS);
}

export function savePlaybackPrefs(next) {
  const merged = { ...getPlaybackPrefs(), ...next };
  writeJson(profileKey(PREFS_KEY), merged);

  // Best-effort sync to the profile row so prefs follow the profile across
  // devices (columns added by 20261007120000_streaming_redesign.sql).
  const profileId = getActiveProfileId();
  if (profileId && isSupabaseConfigured && supabase) {
    supabase
      .from('account_profiles')
      .update({ audio_pref: merged.audio, subtitle_pref: merged.subtitles })
      .eq('id', profileId)
      .then(() => {}, () => {});
  }
  return merged;
}

// Adopt the profile row's languages (written on every change, so it's the
// freshest copy when switching devices).
export function hydratePlaybackPrefs(profile) {
  if (!profile || !(profile.audio_pref || profile.subtitle_pref)) return;
  writeJson(profileKey(PREFS_KEY), {
    ...getPlaybackPrefs(),
    ...(profile.audio_pref ? { audio: profile.audio_pref } : {}),
    ...(profile.subtitle_pref ? { subtitles: profile.subtitle_pref } : {}),
  });
}

// The language the viewer wants to hear for a given title.
export function wantedAudio(prefs, originalLanguage) {
  if (!prefs || prefs.audio === 'original') return originalLanguage || null;
  return prefs.audio;
}

// ── Per-title server memory (this profile, this device) ───────────────

function memoryStore() {
  return readJson(profileKey(MEMORY_KEY), {});
}

export function getServerMemory(mediaType, mediaId) {
  return memoryStore()[`${mediaType}:${mediaId}`] || null;
}

export function rememberServer(mediaType, mediaId, patch) {
  const store = memoryStore();
  const key = `${mediaType}:${mediaId}`;
  store[key] = { ...(store[key] || {}), ...patch, at: Date.now() };
  // Keep the store small: newest 300 titles.
  const entries = Object.entries(store).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, 300);
  writeJson(profileKey(MEMORY_KEY), Object.fromEntries(entries));
}

// ── Community reports ──────────────────────────────────────────────────

export async function fetchReportSummary(mediaType, mediaId) {
  if (!isSupabaseConfigured || !supabase || !mediaId) return [];
  try {
    const { data, error } = await supabase.rpc('stream_report_summary', {
      p_media_type: mediaType,
      p_media_id: Number(mediaId),
    });
    return error ? [] : (data || []);
  } catch {
    return [];
  }
}

export async function submitStreamReport({ mediaType, mediaId, provider, works, audioLang = null, hasSubs = null }) {
  rememberServer(mediaType, mediaId, works
    ? { provider, ...(audioLang ? { audio: audioLang } : {}) }
    : { [`broken:${provider}`]: Date.now() });

  if (!isSupabaseConfigured || !supabase || !mediaId) return;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const row = {
      user_id: user.id,
      media_type: mediaType,
      media_id: Number(mediaId),
      provider,
      works,
      updated_at: new Date().toISOString(),
    };
    if (audioLang) row.audio_lang = audioLang;
    if (hasSubs != null) row.has_subs = hasSubs;
    await supabase.from('stream_reports').upsert(row, { onConflict: 'user_id,media_type,media_id,provider' });
  } catch {
    // Table not deployed yet / offline — local memory above still works.
  }
}

// ── Provider health across all titles ──────────────────────────────────

let healthCache = null; // { at, promise }
let lastHealth = {}; // resolved copy, so synchronous ranking can use it
const HEALTH_TTL_MS = 10 * 60 * 1000;

// { [provider]: { works24h, broken24h, works7d, broken7d, down, usuallyWorks } }
export function fetchProviderHealth() {
  if (healthCache && Date.now() - healthCache.at < HEALTH_TTL_MS) return healthCache.promise;
  const promise = (async () => {
    if (!isSupabaseConfigured || !supabase) return {};
    try {
      const { data, error } = await supabase.rpc('stream_provider_health');
      if (error) return {};
      lastHealth = Object.fromEntries((data || []).map((row) => [row.provider, summarizeHealth(row)]));
      return lastHealth;
    } catch {
      return {};
    }
  })();
  healthCache = { at: Date.now(), promise };
  return promise;
}

export function summarizeHealth(row) {
  const works24h = Number(row.works_24h) || 0;
  const broken24h = Number(row.broken_24h) || 0;
  const works7d = Number(row.works_7d) || 0;
  const broken7d = Number(row.broken_7d) || 0;
  const total7d = works7d + broken7d;
  return {
    works24h,
    broken24h,
    works7d,
    broken7d,
    // Several different viewers couldn't play it today, and few could.
    down: broken24h >= 3 && broken24h >= works24h * 2,
    usuallyWorks: total7d >= 3 && works7d / total7d >= 0.7,
  };
}

// ── Ranking ────────────────────────────────────────────────────────────

/**
 * Orders servers best-first for this viewer and title.
 * @returns {{ id, score, audio: string|null, audioVotes: number, note: string }[]}
 */
export function rankServers(providerIds, { prefs, originalLanguage, summary = [], memory = null, health = lastHealth }) {
  const want = wantedAudio(prefs, originalLanguage);
  const byProvider = new Map(summary.map((row) => [row.provider, row]));
  const RECENT_BROKEN_MS = 6 * 60 * 60 * 1000;

  return providerIds
    .map((id, index) => {
      const report = byProvider.get(id);
      const works = Number(report?.works_count) || 0;
      const broken = Number(report?.broken_count) || 0;
      const audio = (memory?.provider === id && memory.audio) || report?.audio_lang || null;
      const audioVotes = Number(report?.audio_count) || 0;

      let score = -index * 0.4; // default order as a weak prior
      score += Math.min(3, works * 0.6) - Math.min(4, broken * 0.9);
      if (memory?.provider === id) score += 4;
      const brokenAt = memory?.[`broken:${id}`];
      if (brokenAt && Date.now() - brokenAt < RECENT_BROKEN_MS) score -= 6;
      // Kept buffering for this title recently (2h): rank it lower.
      const slowAt = memory?.[`slow:${id}`];
      if (slowAt && Date.now() - slowAt < 2 * 60 * 60 * 1000) score -= 3;
      if (want && audio) score += audio === want ? 5 : -4;
      const providerHealth = health[id];
      if (providerHealth?.down) score -= 5;
      else if (providerHealth?.usuallyWorks) score += 0.8;

      // status drives the ✓ / ⚠ tag in the server menu.
      let note = '';
      let status = 'unknown';
      if (memory?.provider === id) { note = 'Worked for you last time'; status = 'good'; }
      else if (works && works >= broken) {
        status = 'good';
        note = audio && audioVotes
          ? `Works for this title · ${audioVotes} heard this audio`
          : `Works for this title (${works} viewer${works === 1 ? '' : 's'})`;
      } else if (providerHealth?.down) { note = 'Down for many viewers today'; status = 'down'; }
      else if (broken) { note = 'Reported not playing for this title'; status = 'bad'; }
      else if (providerHealth?.usuallyWorks) { note = 'Usually works'; status = 'ok'; }

      return { id, score, audio, audioVotes, note, status };
    })
    .sort((a, b) => b.score - a.score);
}
