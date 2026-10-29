create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create table if not exists public.profile_locks (
  profile_id uuid primary key references public.account_profiles(id) on delete cascade,
  pin_hash text not null,
  attempts integer not null default 0,
  blocked_until timestamptz
);
alter table public.profile_locks enable row level security;
revoke all on public.profile_locks from anon, authenticated;

create or replace function public.set_profile_lock(target_profile uuid, new_pin text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists(select 1 from public.account_profiles where id = target_profile and account_id = auth.uid()) then
    raise exception 'Profile not found';
  end if;
  if new_pin is null then
    delete from public.profile_locks where profile_id = target_profile;
  elsif new_pin ~ '^[0-9]{4}$' then
    insert into public.profile_locks(profile_id, pin_hash) values(target_profile, crypt(new_pin, gen_salt('bf')))
    on conflict(profile_id) do update set pin_hash = excluded.pin_hash, attempts = 0, blocked_until = null;
  else raise exception 'PIN must contain exactly four digits';
  end if;
end; $$;

create or replace function public.list_profile_locks()
returns table(profile_id uuid) language sql security definer set search_path = public as $$
  select l.profile_id from public.profile_locks l join public.account_profiles p on p.id = l.profile_id where p.account_id = auth.uid();
$$;

create or replace function public.verify_profile_pin(target_profile uuid, entered_pin text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare lock_row public.profile_locks;
begin
  if not exists(select 1 from public.account_profiles where id = target_profile and account_id = auth.uid()) then return false; end if;
  select * into lock_row from public.profile_locks where profile_id = target_profile for update;
  if not found then return true; end if;
  if lock_row.blocked_until > now() then return false; end if;
  if entered_pin ~ '^[0-9]{4}$' and crypt(entered_pin, lock_row.pin_hash) = lock_row.pin_hash then
    update public.profile_locks set attempts = 0, blocked_until = null where profile_id = target_profile;
    return true;
  end if;
  update public.profile_locks set attempts = case when attempts >= 4 then 0 else attempts + 1 end,
    blocked_until = case when attempts >= 4 then now() + interval '5 minutes' else null end where profile_id = target_profile;
  return false;
end; $$;
revoke all on function public.set_profile_lock(uuid,text), public.list_profile_locks(), public.verify_profile_pin(uuid,text) from public, anon;
grant execute on function public.set_profile_lock(uuid,text), public.list_profile_locks(), public.verify_profile_pin(uuid,text) to authenticated;
