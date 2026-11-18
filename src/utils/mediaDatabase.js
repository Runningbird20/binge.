// Shared by the browser and server: this is the complete media catalog
// (Turso) allowlist. Everything else is Supabase.
const MEDIA_TABLES = new Set([
  'movies', 'tv_shows', 'movie_genres', 'tv_show_genres',
  'title_ratings', 'episode_ratings_cache', 'subtitle_cache',
]);
// Catalog functions (server/data-access/client.js rpc); every other rpc is Supabase's.
const CATALOG_RPCS = new Set(['search_catalog', 'search_related']);
function splitDatabaseClient(supabase, catalog) {
  return {
    auth: supabase.auth,
    storage: supabase.storage,
    from: (table) => MEDIA_TABLES.has(table) ? catalog.from(table) : supabase.from(table),
    rpc: (name, args) => CATALOG_RPCS.has(name) ? catalog.rpc(name, args) : supabase.rpc(name, args),
    // Realtime is Supabase's alone (the notification inbox listens for new rows).
    channel: (...args) => supabase.channel(...args),
    removeChannel: (channel) => supabase.removeChannel(channel),
  };
}
module.exports = { MEDIA_TABLES, CATALOG_RPCS, splitDatabaseClient };
