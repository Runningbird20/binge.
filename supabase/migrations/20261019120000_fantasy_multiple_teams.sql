-- Several ESPN Fantasy teams per profile: any number per sport (several
-- leagues, or a league-mate's team to keep an eye on). The old index allowed
-- one league per sport per profile.
drop index if exists public.idx_fantasy_leagues_unique;
create unique index if not exists idx_fantasy_leagues_team
  on public.fantasy_leagues (user_id, coalesce(profile_id, '00000000-0000-0000-0000-000000000000'::uuid), game, league_id, coalesce(team_id, -1));
