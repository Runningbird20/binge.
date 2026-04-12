begin;

drop trigger if exists on_auth_user_changed on auth.users;

drop table if exists public.media_list_votes cascade;
drop table if exists public.media_list_collaborators cascade;
drop table if exists public.media_list_items cascade;
drop table if exists public.media_lists cascade;
drop table if exists public.media_requests cascade;
drop table if exists public.chat_logs cascade;
drop table if exists public.watchlist cascade;
drop table if exists public.movie_ratings cascade;
drop table if exists public.tv_show_ratings cascade;
drop table if exists public.book_ratings cascade;
drop table if exists public.movies cascade;
drop table if exists public.tv_shows cascade;
drop table if exists public.books cascade;
drop table if exists public.todos cascade;
drop table if exists public.profiles cascade;
drop table if exists public.users cascade;

drop function if exists public.handle_auth_user_changed();
drop function if exists public.set_updated_at();

commit;
