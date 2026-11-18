-- New alerts reach the bell at once instead of on its next poll: Supabase
-- Realtime sends inserts into `notifications` (and read marks, as updates) to
-- the signed-in app (src/hooks/useNotifications.js). Realtime applies the
-- table's select policy (notifications_read_own) to every subscriber, so an
-- account only ever receives its own rows. Safe to run again, and a no-op on a
-- Postgres without Supabase's realtime publication.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
     ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
