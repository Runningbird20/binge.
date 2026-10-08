// IMDb / Rotten Tomatoes / Metacritic for a title. Looked up through the
// server (OMDb key stays server-side) and cached in Supabase title_ratings,
// shared by everyone. Cards read that cache in batches (no OMDb calls), so
// a card shows outside ratings once anyone has opened that title.
import { api } from '../api';
import { supabase, isSupabaseConfigured } from './supabase';
import { tmdbIdFromItem } from './tmdb';

const cache = new Map(); // source_key -> row | null
const pending = new Map(); // source_key -> [resolve]
let flushTimer = null;

export function sourceKeyOf(item) {
  const tmdbId = tmdbIdFromItem(item);
  if (!tmdbId) return null;
  const kind = item.media_type === 'tv_show' ? 'tv' : item.media_type === 'movie' ? 'movie' : null;
  return kind ? `tmdb:${kind}:${tmdbId}` : null;
}

// Full lookup (title page). May spend one OMDb request on a cache miss.
export async function fetchOutsideRatings(item) {
  const key = sourceKeyOf(item);
  if (!key) return null;
  if (cache.get(key)?.imdb_rating != null || cache.get(key)?.unavailable) return cache.get(key);
  const [, kind, id] = key.split(':');
  try {
    const row = await api.get(`/extras/ratings?type=${kind}&tmdb=${id}`);
    cache.set(key, row);
    return row;
  } catch {
    return null;
  }
}

async function flush() {
  flushTimer = null;
  const keys = [...pending.keys()];
  const waiting = new Map(pending);
  pending.clear();
  let rows = [];
  if (isSupabaseConfigured && supabase && keys.length) {
    const { data } = await supabase.from('title_ratings').select('source_key, imdb_rating, imdb_votes, rotten_tomatoes, metacritic').in('source_key', keys);
    rows = data || [];
  }
  const byKey = new Map(rows.map((row) => [row.source_key, row]));
  keys.forEach((key) => {
    const row = byKey.get(key) || null;
    if (!cache.has(key) || row) cache.set(key, row);
    (waiting.get(key) || []).forEach((resolve) => resolve(cache.get(key)));
  });
}

// Cached-only read for cards, batched (one query per ~100 cards).
export function cachedOutsideRatings(item) {
  const key = sourceKeyOf(item);
  if (!key) return Promise.resolve(null);
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  return new Promise((resolve) => {
    pending.set(key, [...(pending.get(key) || []), resolve]);
    if (pending.size >= 100) flush();
    else if (!flushTimer) flushTimer = setTimeout(flush, 60);
  });
}

export function formatVotes(votes) {
  const n = Number(votes) || 0;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(n);
}
