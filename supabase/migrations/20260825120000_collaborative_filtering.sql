-- "Other members with similar tastes" recommendation signal, computed
-- entirely server-side. RLS on movie_ratings/tv_show_ratings/book_ratings/
-- watchlist only allows a user to read their own rows plus rows of people
-- they follow (see the *_select_own policies below) — not arbitrary other
-- users. These functions run `security definer` so they can read across
-- every user's rows internally, but only ever return aggregated
-- (media_id, affinity) pairs — never a raw row belonging to another user —
-- so no RLS policy needs to change and no individual's rating/watchlist
-- data is exposed to the client.
--
-- Shape, mirrored per media type (matches the app's existing convention of
-- separate movie_ratings/tv_show_ratings/book_ratings tables):
--   1. my_likes: the target (user_id, profile_id)'s highly-rated or
--      watched/read titles.
--   2. neighbors: other (user_id, profile_id) pairs who also liked at
--      least one of those same titles, capped to the top 200 by overlap
--      so the query stays cheap regardless of how many users the app has.
--   3. result: the other titles those neighbors liked, excluding the
--      target's own titles, ranked by summed neighbor overlap.

create or replace function public.collaborative_movie_candidates(
  p_user_id uuid,
  p_profile_id uuid,
  p_limit integer default 30
)
returns table (media_id bigint, affinity numeric)
language sql
stable
security definer
set search_path = public
as $$
  with my_likes as (
    select mr.media_id
    from public.movie_ratings mr
    where mr.user_id = p_user_id
      and mr.profile_id is not distinct from p_profile_id
      and (mr.acting + mr.writing + mr.originality + mr.pacing + mr.cinematography) / 5.0 >= 4.0
    union
    select w.media_id
    from public.watchlist w
    where w.user_id = p_user_id
      and w.profile_id is not distinct from p_profile_id
      and w.media_type = 'movie'
      and w.status = 'watched'
  ),
  neighbors as (
    select mr.user_id, mr.profile_id, count(*) as overlap
    from public.movie_ratings mr
    join my_likes ml on ml.media_id = mr.media_id
    where (mr.acting + mr.writing + mr.originality + mr.pacing + mr.cinematography) / 5.0 >= 4.0
      and not (mr.user_id = p_user_id and mr.profile_id is not distinct from p_profile_id)
    group by mr.user_id, mr.profile_id
    order by count(*) desc
    limit 200
  ),
  neighbor_likes as (
    select mr.media_id, n.overlap
    from public.movie_ratings mr
    join neighbors n on n.user_id = mr.user_id and n.profile_id is not distinct from mr.profile_id
    where (mr.acting + mr.writing + mr.originality + mr.pacing + mr.cinematography) / 5.0 >= 4.0
    union all
    select w.media_id, n.overlap
    from public.watchlist w
    join neighbors n on n.user_id = w.user_id and n.profile_id is not distinct from w.profile_id
    where w.media_type = 'movie' and w.status = 'watched'
  )
  select nl.media_id, sum(nl.overlap)::numeric as affinity
  from neighbor_likes nl
  where nl.media_id not in (select media_id from my_likes)
  group by nl.media_id
  order by affinity desc
  limit p_limit;
$$;

create or replace function public.collaborative_tv_candidates(
  p_user_id uuid,
  p_profile_id uuid,
  p_limit integer default 30
)
returns table (media_id bigint, affinity numeric)
language sql
stable
security definer
set search_path = public
as $$
  with my_likes as (
    select tr.media_id
    from public.tv_show_ratings tr
    where tr.user_id = p_user_id
      and tr.profile_id is not distinct from p_profile_id
      and (tr.premise + tr.originality + tr.acting + tr.cinematography + tr.writing + tr.pacing + tr.resonance) / 7.0 >= 4.0
    union
    select w.media_id
    from public.watchlist w
    where w.user_id = p_user_id
      and w.profile_id is not distinct from p_profile_id
      and w.media_type = 'tv_show'
      and w.status = 'watched'
  ),
  neighbors as (
    select tr.user_id, tr.profile_id, count(*) as overlap
    from public.tv_show_ratings tr
    join my_likes ml on ml.media_id = tr.media_id
    where (tr.premise + tr.originality + tr.acting + tr.cinematography + tr.writing + tr.pacing + tr.resonance) / 7.0 >= 4.0
      and not (tr.user_id = p_user_id and tr.profile_id is not distinct from p_profile_id)
    group by tr.user_id, tr.profile_id
    order by count(*) desc
    limit 200
  ),
  neighbor_likes as (
    select tr.media_id, n.overlap
    from public.tv_show_ratings tr
    join neighbors n on n.user_id = tr.user_id and n.profile_id is not distinct from tr.profile_id
    where (tr.premise + tr.originality + tr.acting + tr.cinematography + tr.writing + tr.pacing + tr.resonance) / 7.0 >= 4.0
    union all
    select w.media_id, n.overlap
    from public.watchlist w
    join neighbors n on n.user_id = w.user_id and n.profile_id is not distinct from w.profile_id
    where w.media_type = 'tv_show' and w.status = 'watched'
  )
  select nl.media_id, sum(nl.overlap)::numeric as affinity
  from neighbor_likes nl
  where nl.media_id not in (select media_id from my_likes)
  group by nl.media_id
  order by affinity desc
  limit p_limit;
$$;

create or replace function public.collaborative_book_candidates(
  p_user_id uuid,
  p_profile_id uuid,
  p_limit integer default 30
)
returns table (media_id bigint, affinity numeric)
language sql
stable
security definer
set search_path = public
as $$
  with my_likes as (
    select br.media_id
    from public.book_ratings br
    where br.user_id = p_user_id
      and br.profile_id is not distinct from p_profile_id
      and (br.prose + br.plot + br.characters + br.originality + br.pacing + br.resonance) / 6.0 >= 4.0
    union
    select w.media_id
    from public.watchlist w
    where w.user_id = p_user_id
      and w.profile_id is not distinct from p_profile_id
      and w.media_type = 'book'
      and w.status = 'read'
  ),
  neighbors as (
    select br.user_id, br.profile_id, count(*) as overlap
    from public.book_ratings br
    join my_likes ml on ml.media_id = br.media_id
    where (br.prose + br.plot + br.characters + br.originality + br.pacing + br.resonance) / 6.0 >= 4.0
      and not (br.user_id = p_user_id and br.profile_id is not distinct from p_profile_id)
    group by br.user_id, br.profile_id
    order by count(*) desc
    limit 200
  ),
  neighbor_likes as (
    select br.media_id, n.overlap
    from public.book_ratings br
    join neighbors n on n.user_id = br.user_id and n.profile_id is not distinct from br.profile_id
    where (br.prose + br.plot + br.characters + br.originality + br.pacing + br.resonance) / 6.0 >= 4.0
    union all
    select w.media_id, n.overlap
    from public.watchlist w
    join neighbors n on n.user_id = w.user_id and n.profile_id is not distinct from w.profile_id
    where w.media_type = 'book' and w.status = 'read'
  )
  select nl.media_id, sum(nl.overlap)::numeric as affinity
  from neighbor_likes nl
  where nl.media_id not in (select media_id from my_likes)
  group by nl.media_id
  order by affinity desc
  limit p_limit;
$$;

grant execute on function public.collaborative_movie_candidates(uuid, uuid, integer) to authenticated;
grant execute on function public.collaborative_tv_candidates(uuid, uuid, integer) to authenticated;
grant execute on function public.collaborative_book_candidates(uuid, uuid, integer) to authenticated;
