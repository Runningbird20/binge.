import { splitDatabaseClient } from './mediaDatabase';
function client(prefix) { return { auth:{provider:prefix}, storage:{provider:prefix}, from:jest.fn(t=>`${prefix}:${t}`), rpc:jest.fn(n=>`${prefix}:${n}`) }; }
test('media metadata goes to Neon while user tables and all auth stay Supabase',()=>{
 const sb=client('supabase'),neon=client('neon');const split=splitDatabaseClient(sb,neon);
 for(const table of ['movies','tv_shows','books','movie_genres','title_ratings','episode_ratings_cache','subtitle_cache'])expect(split.from(table)).toBe(`neon:${table}`);
 for(const table of ['profiles','account_profiles','watchlist','movie_ratings','book_ratings','continue_watching','episode_progress','profile_locks','fantasy_leagues','push_subscriptions'])expect(split.from(table)).toBe(`supabase:${table}`);
 expect(split.auth).toBe(sb.auth);expect(split.storage).toBe(sb.storage);
});
test('search RPC uses Neon; PIN and community RPCs stay Supabase',()=>{
 const sb=client('supabase'),neon=client('neon');const split=splitDatabaseClient(sb,neon);
 expect(split.rpc('search_catalog',{q:'Alien'})).toBe('neon:search_catalog');
 for(const name of ['list_profile_locks','set_profile_lock','verify_profile_pin','episode_marker_summary','stream_provider_health','admin_stats'])expect(split.rpc(name,{})).toBe(`supabase:${name}`);
});
