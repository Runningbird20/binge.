-- Records objects that were removed from Supabase outside the migration
-- history, so the history matches the live database (and
-- scripts/check-supabase-migrations.js doesn't expect them):
--   * forums, lists, chat logs and todos — features the app no longer has
--     (nothing in src/ or server/ reads these tables);
--   * search_catalog — moved to Neon; 20261028160000_media_moves_to_neon.sql
--     drops it in a dynamic block the checker can't read.
-- Safe to run: everything is "if exists", and Supabase no longer has any of it.

drop table if exists public.comment_votes cascade;
drop table if exists public.comments cascade;
drop table if exists public.post_votes cascade;
drop table if exists public.forum_members cascade;
drop table if exists public.forums cascade;
drop table if exists public.list_comments cascade;
drop table if exists public.media_list_collaborators cascade;
drop table if exists public.media_list_items cascade;
drop table if exists public.media_requests cascade;
drop table if exists public.chat_logs cascade;
drop table if exists public.chat_errors cascade;
drop table if exists public.todos cascade;

drop function if exists public.search_catalog(text, integer);
