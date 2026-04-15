const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL)?.trim();
const SUPABASE_KEY = (
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY ||
  process.env.REACT_APP_SUPABASE_KEY
)?.trim();

const supabase = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null;

function isSupabaseConfigured() {
  return Boolean(supabase);
}

function requireSupabase() {
  if (!supabase) {
    throw new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY.');
  }
  return supabase;
}

function buildSearchQuery(terms, fields) {
  if (!terms.length) return null;
  const clauses = terms
    .slice(0, 4)
    .map((term) => fields.map((field) => `${field}.ilike.%${term}%`).join(','));
  return clauses.join(',');
}

async function queryCatalogTable(table, fields, selectFields, terms, limit) {
  const client = requireSupabase();
  const searchFilter = buildSearchQuery(terms, fields);

  let query = client
    .from(table)
    .select(selectFields)
    .not('source_key', 'is', null)
    .neq('source_key', '');

  if (searchFilter) {
    query = query.or(searchFilter);
  }

  let { data, error } = await query.limit(limit);

  if (error) {
    throw error;
  }

  const results = data || [];

  if (searchFilter && results.length < limit) {
    const fallback = await client
      .from(table)
      .select(selectFields)
      .not('source_key', 'is', null)
      .neq('source_key', '')
      .limit(limit);

    if (fallback.error) {
      throw fallback.error;
    }

    const items = fallback.data || [];
    const existingKeys = new Set(results.map((item) => `${item.id}:${table}`));
    items.forEach((item) => {
      const key = `${item.id}:${table}`;
      if (!existingKeys.has(key) && results.length < limit) {
        results.push(item);
        existingKeys.add(key);
      }
    });
  }

  return results;
}

async function fetchSupabaseCatalog(query, limit = 20) {
  if (!query) {
    return fetchSupabaseCatalogItems(limit);
  }

  const terms = query
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((term) => term.length > 2)
    .slice(0, 5);

  const movieFields = ['title', 'genre', 'director', 'cast_members', 'overview', 'synopsis'];
  const tvFields = ['title', 'genre', 'creator', 'cast_members', 'overview', 'synopsis'];
  const bookFields = ['title', 'genre', 'author', 'synopsis'];

  const [movies, tvShows, books] = await Promise.all([
    fetchMediaItems('movies', movieFields, 'id,title,year,genre,director,cast_members,overview,synopsis,source_key,poster_url', terms, limit),
    fetchMediaItems('tv_shows', tvFields, 'id,title,year,genre,creator,cast_members,overview,synopsis,seasons,source_key,poster_url', terms, limit),
    fetchMediaItems('books', bookFields, 'id,title,year,genre,author,synopsis,cover_url,source_key', terms, limit),
  ]);

  const combined = [...movies, ...tvShows, ...books];
  const seen = new Set();

  return combined.filter((item) => {
    const key = `${item.media_type}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}

async function fetchMediaItems(table, searchFields, selectFields, terms, limit) {
  const rows = await queryCatalogTable(table, searchFields, selectFields, terms, limit);
  return rows.map((row) => ({
    ...row,
    media_type: table === 'movies' ? 'movie' : table === 'tv_shows' ? 'tv_show' : 'book',
  }));
}

async function fetchSupabaseCatalogItems(limitEach = 100) {
  const [movies, tvShows, books] = await Promise.all([
    fetchMediaItems('movies', [], 'id,title,year,genre,director,cast_members,overview,synopsis,source_key,poster_url', [], limitEach),
    fetchMediaItems('tv_shows', [], 'id,title,year,genre,creator,cast_members,overview,synopsis,seasons,source_key,poster_url', [], limitEach),
    fetchMediaItems('books', [], 'id,title,year,genre,author,synopsis,cover_url,source_key', [], limitEach),
  ]);
  return [...movies, ...tvShows, ...books];
}

module.exports = {
  supabase,
  isSupabaseConfigured,
  fetchSupabaseCatalog,
  fetchSupabaseCatalogItems,
};
