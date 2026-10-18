// Intro and credits markers for an episode, so "Skip intro" lands exactly
// where the show starts and Up Next appears when the credits do.
//
// Streaming services tag their own video files; binge. doesn't own the
// files, so markers come from two places:
//   1. AniSkip (anime only): a public, community-timed database of openings
//      and endings, matched through AniList's MyAnimeList id.
//   2. Our viewers: skipping ahead early in an episode reports where the
//      intro started and ended, moving on to the next episode reports where
//      the credits began. Once 2+ viewers agree, everyone gets the median
//      (episode_marker_summary RPC); a show's usual intro covers episodes
//      nobody has timed yet.

import { supabase, isSupabaseConfigured } from './supabase';
import { anilistQuery } from './anilist';

const cache = new Map(); // key -> Promise<markers>
const malCache = new Map(); // "title|season" -> Promise<malId|null>

// A forward jump that looks like skipping an intro: early in the episode,
// 15s–3.5min long.
export function looksLikeIntroSkip(from, to, duration = 0) {
  if (!(from >= 0) || !(to > from)) return false;
  const jump = to - from;
  const early = from < Math.min(600, duration > 0 ? duration * 0.35 : 600);
  return early && jump >= 15 && jump <= 210;
}

// Moving on this far into an episode (but before its last 20s) means the
// credits had started.
export function looksLikeCredits(time, duration) {
  if (!(duration > 300) || !(time > 0)) return false;
  return time / duration >= 0.85 && duration - time >= 20;
}

function key(mediaId, season, episode) {
  return `${mediaId}:${season}:${episode}`;
}

async function crowdMarkers(mediaId, season, episode) {
  if (!isSupabaseConfigured || !supabase) return {};
  const { data, error } = await supabase.rpc('episode_marker_summary', {
    p_media_id: Number(mediaId), p_season: Number(season), p_episode: Number(episode),
  });
  if (error || !Array.isArray(data)) return {};
  const out = {};
  data.forEach((row) => {
    if (row.kind === 'intro' && row.end_s > row.start_s) {
      out.intro = { start: row.start_s, end: row.end_s, source: row.source === 'show' ? 'show' : 'viewers', viewers: row.viewers };
    }
    if (row.kind === 'credits') out.credits = { start: row.start_s, source: 'viewers', viewers: row.viewers };
  });
  return out;
}

// Animated and not known to be non-Japanese (the catalog's language is
// often empty); AniList then has to confirm a Japanese title of that name.
function maybeAnime(item) {
  const genres = String(item?.genre || '').toLowerCase();
  const language = item?.original_language;
  return genres.includes('animation') && (!language || language === 'ja');
}

const normalizeTitle = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function aniListMatches(media, title, season) {
  if (!media?.idMal || media.countryOfOrigin !== 'JP') return false;
  const wanted = normalizeTitle(title);
  const names = [media.title?.english, media.title?.romaji, ...(media.synonyms || [])].map(normalizeTitle).filter(Boolean);
  return names.some((name) => (season > 1 ? name.startsWith(wanted) : name === wanted));
}

// AniList keeps each season as its own entry; later seasons are found by
// "<title> Season N" and must have enough episodes.
function malIdFor(title, season, episode) {
  const cacheKey = `${title}|${season}`;
  if (!malCache.has(cacheKey)) {
    const search = season > 1 ? `${title} Season ${season}` : title;
    malCache.set(cacheKey, anilistQuery(
      'query($s:String){Media(search:$s,type:ANIME){idMal episodes countryOfOrigin synonyms title{english romaji}}}',
      { s: search },
    ).then((data) => {
      const media = data?.Media;
      if (!aniListMatches(media, title, season)) return null;
      if (media.episodes && episode > media.episodes) return null;
      return media.idMal;
    }).catch(() => null));
  }
  return malCache.get(cacheKey);
}

async function aniSkipMarkers(item, season, episode) {
  if (!maybeAnime(item) || !item?.title) return {};
  const malId = await malIdFor(item.title, Number(season) || 1, Number(episode) || 1);
  if (!malId) return {};
  try {
    const res = await fetch(
      `https://api.aniskip.com/v2/skip-times/${malId}/${Number(episode)}?types[]=op&types[]=ed&episodeLength=0`,
      { signal: AbortSignal.timeout?.(6000) },
    );
    if (!res.ok) return {};
    const data = await res.json();
    const out = {};
    (data.results || []).forEach((result) => {
      const { startTime, endTime } = result.interval || {};
      if (!(endTime > startTime)) return;
      if (result.skipType === 'op' && !out.intro) out.intro = { start: startTime, end: endTime, source: 'aniskip' };
      if (result.skipType === 'ed' && !out.credits) out.credits = { start: startTime, source: 'aniskip' };
    });
    return out;
  } catch {
    return {};
  }
}

// { intro?: {start, end, source}, credits?: {start, source} }. Viewer
// markers for this episode win; AniSkip fills gaps; a show-wide intro
// estimate is the last resort.
export function fetchEpisodeMarkers(item, season, episode) {
  if (!item?.id || !season || !episode) return Promise.resolve({});
  const cacheKey = key(item.id, season, episode);
  if (!cache.has(cacheKey)) {
    cache.set(cacheKey, Promise.all([
      crowdMarkers(item.id, season, episode).catch(() => ({})),
      aniSkipMarkers(item, season, episode).catch(() => ({})),
    ]).then(([crowd, anime]) => {
      const intro = crowd.intro?.source === 'viewers' ? crowd.intro : (anime.intro || crowd.intro);
      const credits = crowd.credits || anime.credits;
      return { ...(intro ? { intro } : {}), ...(credits ? { credits } : {}) };
    }));
  }
  return cache.get(cacheKey);
}

async function report(row) {
  if (!isSupabaseConfigured || !supabase) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from('episode_markers').upsert({ ...row, user_id: user.id, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,media_id,season,episode,kind' });
  cache.delete(key(row.media_id, row.season, row.episode));
}

export function reportIntro({ mediaId, season, episode, start, end, duration }) {
  if (!mediaId || !looksLikeIntroSkip(start, end, duration)) return Promise.resolve();
  return report({
    media_id: Number(mediaId), season: Number(season), episode: Number(episode), kind: 'intro',
    start_s: Math.round(start * 10) / 10, end_s: Math.round(end * 10) / 10, duration_s: duration || null,
  }).catch(() => {});
}

export function reportCredits({ mediaId, season, episode, start, duration }) {
  if (!mediaId || !looksLikeCredits(start, duration)) return Promise.resolve();
  return report({
    media_id: Number(mediaId), season: Number(season), episode: Number(episode), kind: 'credits',
    start_s: Math.round(start * 10) / 10, end_s: null, duration_s: duration || null,
  }).catch(() => {});
}
