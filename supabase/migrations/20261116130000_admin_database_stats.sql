-- Sizes for Admin → Databases (server/routes/databaseHealth.js): the whole
-- database, its largest tables (with Postgres's row estimates), file storage
-- and accounts. Only the service role (the server's /api/ops/databases, which
-- checks the caller is an admin) may call it.
create or replace function public.admin_database_stats()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'database_bytes', pg_database_size(current_database()),
    'tables', (
      select coalesce(jsonb_agg(t order by t.bytes desc), '[]'::jsonb)
      from (
        select c.relname as name, pg_total_relation_size(c.oid) as bytes, greatest(c.reltuples, 0)::bigint as rows
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
        order by pg_total_relation_size(c.oid) desc
        limit 8
      ) t
    ),
    'storage_bytes', (select coalesce(sum((o.metadata->>'size')::bigint), 0) from storage.objects o),
    'storage_files', (select count(*) from storage.objects),
    'accounts', (select count(*) from auth.users)
  );
$$;
revoke execute on function public.admin_database_stats() from public, anon, authenticated;
grant execute on function public.admin_database_stats() to service_role;
