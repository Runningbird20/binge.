// Shared by the browser and server: this is the complete media catalog
// (Turso) allowlist. Everything else is Supabase.
const MEDIA_TABLES = new Set([
  'movies', 'tv_shows', 'books', 'movie_genres', 'tv_show_genres', 'book_genres',
  'title_ratings', 'episode_ratings_cache', 'subtitle_cache',
]);
function splitDatabaseClient(supabase, catalog) {
  return {
    auth: supabase.auth,
    storage: supabase.storage,
    from: (table) => MEDIA_TABLES.has(table) ? catalog.from(table) : supabase.from(table),
    rpc: (name, args) => name === 'search_catalog' ? catalog.rpc(name, args) : supabase.rpc(name, args),
  };
}
module.exports = { MEDIA_TABLES, splitDatabaseClient };
