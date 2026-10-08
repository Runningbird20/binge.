const express = require('express');

const router = express.Router();

// Server-side helpers that need secret keys (OMDb, Groq) or shared caching:
//   GET  /api/extras/ratings?type=movie|tv&tmdb=ID     IMDb / RT / Metacritic
//   GET  /api/extras/episodes?tmdb=ID&season=N          IMDb episode ratings
//   POST /api/extras/ai/picks { q }                     conversational search
// OMDB_API_KEY (free, 1,000 requests/day) and GROQ_API_KEY are server-only.
// Results are cached in Supabase (title_ratings, episode_ratings_cache) via
// the service role so the OMDb quota is shared across all users.

const TMDB = 'https://api.themoviedb.org/3';
const RATINGS_TTL_MS = 7 * 86400000;
const EPISODES_TTL_MS = 3 * 86400000;
const memory = new Map(); // short-lived in-process cache: key -> { at, value }

function remember(key, ttl, compute) {
  const hit = memory.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = compute().catch((error) => { memory.delete(key); throw error; });
  memory.set(key, { at: Date.now(), value });
  if (memory.size > 2000) memory.delete(memory.keys().next().value);
  return value;
}

function adminDb() {
  const url = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return require('@supabase/supabase-js').createClient(url, key, { auth: { persistSession: false } });
}

async function getJson(url, init) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`${new URL(url).hostname} ${res.status}`);
  return res.json();
}

function tmdbKey() {
  return process.env.TMDB_API_KEY || process.env.REACT_APP_TMDB_API_KEY;
}

function validId(value) {
  return /^[0-9]{1,9}$/.test(String(value || ''));
}

async function imdbIdFor(type, tmdbId) {
  return remember(`imdb:${type}:${tmdbId}`, 86400000, async () => {
    const data = await getJson(`${TMDB}/${type}/${tmdbId}/external_ids?api_key=${tmdbKey()}`);
    return data.imdb_id || null;
  });
}

function toNumber(value) {
  const n = Number(String(value || '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ── Outside ratings ────────────────────────────────────────────────────

router.get('/ratings', async (req, res) => {
  const type = req.query.type === 'tv' ? 'tv' : 'movie';
  if (!validId(req.query.tmdb)) return res.status(400).json({ error: 'bad tmdb id' });
  const sourceKey = `tmdb:${type}:${req.query.tmdb}`;
  const db = adminDb();
  try {
    if (db) {
      const { data: cached } = await db.from('title_ratings').select('*').eq('source_key', sourceKey).maybeSingle();
      if (cached && Date.now() - new Date(cached.fetched_at).getTime() < RATINGS_TTL_MS) return res.json(cached);
    }
    if (!process.env.OMDB_API_KEY) return res.json({ source_key: sourceKey, unavailable: 'no-omdb-key' });
    const row = await remember(`ratings:${sourceKey}`, 3600000, async () => {
      const imdbId = await imdbIdFor(type, req.query.tmdb);
      if (!imdbId) return { source_key: sourceKey, imdb_id: null };
      const omdb = await getJson(`https://www.omdbapi.com/?apikey=${process.env.OMDB_API_KEY}&i=${imdbId}&tomatoes=true`);
      const find = (name) => (omdb.Ratings || []).find((entry) => entry.Source === name)?.Value;
      return {
        source_key: sourceKey,
        imdb_id: imdbId,
        imdb_rating: toNumber(omdb.imdbRating),
        imdb_votes: toNumber(omdb.imdbVotes),
        rotten_tomatoes: toNumber(find('Rotten Tomatoes')),
        metacritic: toNumber(omdb.Metascore) ?? toNumber(find('Metacritic')),
        fetched_at: new Date().toISOString(),
      };
    });
    if (db && row.imdb_id) await db.from('title_ratings').upsert(row);
    res.set('Cache-Control', 'public, max-age=3600').json(row);
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

// ── IMDb episode ratings (heatmap) ─────────────────────────────────────

router.get('/episodes', async (req, res) => {
  const season = Number(req.query.season);
  if (!validId(req.query.tmdb) || !(season >= 0 && season < 200)) return res.status(400).json({ error: 'bad params' });
  if (!process.env.OMDB_API_KEY) return res.json({ unavailable: 'no-omdb-key', episodes: [] });
  const db = adminDb();
  try {
    const imdbId = await imdbIdFor('tv', req.query.tmdb);
    if (!imdbId) return res.json({ episodes: [] });
    if (db) {
      const { data: cached } = await db.from('episode_ratings_cache').select('*').eq('imdb_id', imdbId).eq('season', season).maybeSingle();
      if (cached && Date.now() - new Date(cached.fetched_at).getTime() < EPISODES_TTL_MS) return res.json({ imdb_id: imdbId, episodes: cached.episodes });
    }
    const episodes = await remember(`episodes:${imdbId}:${season}`, 3600000, async () => {
      const omdb = await getJson(`https://www.omdbapi.com/?apikey=${process.env.OMDB_API_KEY}&i=${imdbId}&Season=${season}`);
      return (omdb.Episodes || []).map((episode) => ({
        episode: Number(episode.Episode),
        title: episode.Title,
        rating: toNumber(episode.imdbRating),
      })).filter((episode) => episode.episode > 0);
    });
    if (db && episodes.length) await db.from('episode_ratings_cache').upsert({ imdb_id: imdbId, season, episodes, fetched_at: new Date().toISOString() });
    res.set('Cache-Control', 'public, max-age=3600').json({ imdb_id: imdbId, episodes });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

// ── Conversational search (Groq) ───────────────────────────────────────

const AI_MODEL = 'openai/gpt-oss-120b';
const AI_SYSTEM = `You recommend movies and TV shows for a streaming site.
Read the viewer's request and reply with JSON only:
{"media_type":"movie"|"tv"|"any","max_runtime":number|null,"summary":"one short sentence restating what they want",
 "suggestions":[{"title":"","year":0,"media_type":"movie"|"tv","why":"max 14 words, specific to their request"}]}
Give 14 suggestions of real, well-known-enough titles that genuinely fit (mood, pace, length, era, language).
Never include a title they named as a reference. Respect runtime limits (minutes) for movies.`;

const aiHits = new Map(); // ip -> [timestamps]
function aiRateLimited(ip) {
  const now = Date.now();
  const recent = (aiHits.get(ip) || []).filter((t) => now - t < 60000);
  recent.push(now);
  aiHits.set(ip, recent);
  return recent.length > 8;
}

async function verifyOnTmdb(suggestion, maxRuntime) {
  const kind = suggestion.media_type === 'tv' ? 'tv' : 'movie';
  const params = new URLSearchParams({ api_key: tmdbKey(), query: String(suggestion.title || '').slice(0, 100), include_adult: 'false' });
  if (suggestion.year) params.set(kind === 'tv' ? 'first_air_date_year' : 'year', String(suggestion.year));
  let data = await getJson(`${TMDB}/search/${kind}?${params}`).catch(() => null);
  if (!data?.results?.length && suggestion.year) {
    params.delete(kind === 'tv' ? 'first_air_date_year' : 'year');
    data = await getJson(`${TMDB}/search/${kind}?${params}`).catch(() => null);
  }
  const hit = (data?.results || [])[0];
  if (!hit) return null;
  if (kind === 'movie' && maxRuntime) {
    const details = await getJson(`${TMDB}/movie/${hit.id}?api_key=${tmdbKey()}`).catch(() => null);
    if (details?.runtime && details.runtime > maxRuntime + 5) return null;
  }
  return { tmdbId: hit.id, mediaType: kind === 'tv' ? 'tv_show' : 'movie', why: String(suggestion.why || '').slice(0, 160), raw: hit };
}

router.post('/ai/picks', async (req, res) => {
  const q = String(req.body?.q || '').trim().slice(0, 240);
  if (q.length < 4) return res.status(400).json({ error: 'Ask for something a little more specific.' });
  if (!process.env.GROQ_API_KEY) return res.status(503).json({ error: 'AI search isn’t set up (GROQ_API_KEY).' });
  if (aiRateLimited(req.ip)) return res.status(429).json({ error: 'Too many requests — try again in a minute.' });
  try {
    const result = await remember(`ai:${q.toLowerCase()}`, 3600000, async () => {
      const completion = await getJson('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: AI_MODEL,
          response_format: { type: 'json_object' },
          reasoning_effort: 'low',
          temperature: 0.4,
          messages: [{ role: 'system', content: AI_SYSTEM }, { role: 'user', content: q }],
        }),
      });
      let parsed = {};
      try { parsed = JSON.parse(completion.choices?.[0]?.message?.content || '{}'); } catch { parsed = {}; }
      const maxRuntime = Number(parsed.max_runtime) || null;
      const suggestions = (Array.isArray(parsed.suggestions) ? parsed.suggestions : []).slice(0, 16);
      // Verify every title on TMDB so nothing made-up gets through.
      const verified = (await Promise.all(suggestions.map((s) => verifyOnTmdb(s, maxRuntime)))).filter(Boolean);
      const seen = new Set();
      return {
        summary: String(parsed.summary || '').slice(0, 200),
        maxRuntime,
        picks: verified.filter((pick) => {
          const key = `${pick.mediaType}:${pick.tmdbId}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }),
      };
    });
    res.json(result);
  } catch (error) {
    res.status(502).json({ error: 'The AI search didn’t respond. Try again.' });
  }
});

module.exports = router;
