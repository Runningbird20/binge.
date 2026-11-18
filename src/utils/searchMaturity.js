// Search on a restricted profile (Toddler / Kids / Teens) shows only what
// the profile's level allows, like every browse row. Search rows don't
// carry age ratings, so they're looked up by id (cached). Movies and series
// need an allowed rating (unrated ones are left out, as on the catalog grid
// and the TV apps). A failed lookup shows nothing rather than everything.
import { isSupabaseConfigured, supabase } from './supabase';
import { ratingsFor } from './kidsMode';

const ratingCache = new Map(); // `${table}:${id}` → age_rating or null

async function ratingsById(table, ids) {
  const wanted = [...new Set(ids.map(Number).filter(Number.isFinite))];
  const missing = wanted.filter((id) => !ratingCache.has(`${table}:${id}`));
  for (let start = 0; start < missing.length; start += 200) {
    const chunk = missing.slice(start, start + 200);
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await supabase.from(table).select('id, age_rating').in('id', chunk);
    if (error) throw error;
    const found = new Map((data || []).map((row) => [Number(row.id), row.age_rating || null]));
    chunk.forEach((id) => ratingCache.set(`${table}:${id}`, found.get(id) ?? null));
  }
  return new Map(wanted.map((id) => [id, ratingCache.get(`${table}:${id}`)]));
}

// mediaType: 'movie' | 'tv' | 'tv_show'.
export async function allowedForProfile(items, mediaType, kidsSafe) {
  if (!kidsSafe || !Array.isArray(items) || !items.length) return items || [];
  if (!isSupabaseConfigured || !supabase) return [];
  const allowed = ratingsFor(kidsSafe);
  try {
    const ratings = await ratingsById(mediaType === 'movie' ? 'movies' : 'tv_shows', items.map((item) => item.media_id ?? item.id));
    return items.filter((item) => allowed.includes(ratings.get(Number(item.media_id ?? item.id))));
  } catch {
    return [];
  }
}

// A /search or /search-related payload with every section filtered.
export async function filterSearchPayload(payload, kidsSafe) {
  if (!kidsSafe || !payload) return payload;
  const sections = [
    ['movies', 'movie'], ['tv', 'tv'],
    ['moviesRelated', 'movie'], ['tvRelated', 'tv'],
  ].filter(([key]) => Array.isArray(payload[key]));
  const filtered = await Promise.all(sections.map(([key, type]) => allowedForProfile(payload[key], type, kidsSafe)));
  const next = { ...payload };
  sections.forEach(([key], index) => { next[key] = filtered[index]; });
  return next;
}

export function resetSearchMaturityCache() { ratingCache.clear(); }
