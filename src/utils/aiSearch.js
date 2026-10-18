// "Ask binge.": natural-language search ("something like Arrival but less
// slow, under 2 hours"). The server asks Groq for suggestions and checks
// each one exists on TMDB; here they're matched to the catalog (so every
// pick is playable) and keep the model's one-line reason.
import { api } from '../api';
import { normalizeTmdbResult } from './tmdb';
import { resolveTmdbItems } from './catalogLookup';

// Words that signal a request rather than a title. Mood words ("dark",
// "funny") aren't enough on their own — they're in too many titles.
const REQUEST_WORDS = /\b(like|similar|under|over|something|anything|recommend|vibe|mood|minutes?|hours?|tonight|movies?|films?|shows?|series|watch)\b/i;

export function isConversational(query) {
  const words = String(query || '').trim().split(/\s+/).filter(Boolean);
  return words.length >= 5 || (words.length >= 3 && REQUEST_WORDS.test(query));
}

// { summary, items } — items are catalog rows with `_reason`.
export async function askBinge(query) {
  const result = await api.post('/extras/ai/picks', { q: query });
  const picks = result?.picks || [];
  const normalized = picks.map((pick) => ({ pick, tmdb: normalizeTmdbResult({ ...pick.raw, media_type: pick.mediaType === 'tv_show' ? 'tv' : 'movie' }, pick.mediaType) }));
  const [movies, shows] = await Promise.all([
    resolveTmdbItems(normalized.filter((entry) => entry.pick.mediaType === 'movie').map((entry) => entry.tmdb), 'movie'),
    resolveTmdbItems(normalized.filter((entry) => entry.pick.mediaType === 'tv_show').map((entry) => entry.tmdb), 'tv_show'),
  ]);
  const byKey = new Map([...movies, ...shows].map((item) => [`${item.media_type}:${item._tmdb?.tmdbId}`, item]));
  const items = normalized
    .map(({ pick }) => {
      const item = byKey.get(`${pick.mediaType}:${pick.tmdbId}`);
      return item ? { ...item, _reason: pick.why } : null;
    })
    .filter(Boolean);
  return { summary: result?.summary || '', items };
}
