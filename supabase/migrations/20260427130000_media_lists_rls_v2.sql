-- Fix infinite recursion in media_list* RLS policies.
--
-- Root cause: collab_select queried media_list_collaborators itself (direct
-- self-reference), and lists_select <-> collab_select formed a mutual loop.
--
-- Fix: SECURITY DEFINER helper functions read the base tables without going
-- through RLS, so policies can call them without triggering recursion.

-- ─── Drop old (broken) policies ──────────────────────────────────────────────

drop policy if exists "lists_select"   on public.media_lists;
drop policy if exists "lists_insert"   on public.media_lists;
drop policy if exists "lists_update"   on public.media_lists;
drop policy if exists "lists_delete"   on public.media_lists;

drop policy if exists "collab_select"  on public.media_list_collaborators;
drop policy if exists "collab_insert"  on public.media_list_collaborators;
drop policy if exists "collab_delete"  on public.media_list_collaborators;

drop policy if exists "items_select"   on public.media_list_items;
drop policy if exists "items_insert"   on public.media_list_items;
drop policy if exists "items_update"   on public.media_list_items;
drop policy if exists "items_delete"   on public.media_list_items;

drop policy if exists "votes_select"   on public.media_list_votes;
drop policy if exists "votes_insert"   on public.media_list_votes;
drop policy if exists "votes_update"   on public.media_list_votes;
drop policy if exists "votes_delete"   on public.media_list_votes;

-- ─── SECURITY DEFINER helpers ────────────────────────────────────────────────
-- These bypass RLS on the underlying tables, so calling them from a policy
-- never re-enters that policy → no recursion.

create or replace function public.is_list_owner(p_list_id bigint)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from public.media_lists
    where id = p_list_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_list_collaborator(p_list_id bigint)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from public.media_list_collaborators
    where list_id = p_list_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_list_public(p_list_id bigint)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from public.media_lists
    where id = p_list_id and is_public = true
  );
$$;

-- ─── media_lists policies ────────────────────────────────────────────────────

create policy "lists_select" on public.media_lists for select
  using (
    user_id = auth.uid()
    or is_public = true
    or public.is_list_collaborator(id)
  );

create policy "lists_insert" on public.media_lists for insert
  with check (user_id = auth.uid());

create policy "lists_update" on public.media_lists for update
  using (user_id = auth.uid());

create policy "lists_delete" on public.media_lists for delete
  using (user_id = auth.uid());

-- ─── media_list_collaborators policies ───────────────────────────────────────

create policy "collab_select" on public.media_list_collaborators for select
  using (
    user_id = auth.uid()
    or public.is_list_owner(list_id)
    or public.is_list_collaborator(list_id)
  );

create policy "collab_insert" on public.media_list_collaborators for insert
  with check (public.is_list_owner(list_id));

create policy "collab_delete" on public.media_list_collaborators for delete
  using (
    user_id = auth.uid()
    or public.is_list_owner(list_id)
  );

-- ─── media_list_items policies ───────────────────────────────────────────────

create policy "items_select" on public.media_list_items for select
  using (
    public.is_list_owner(list_id)
    or public.is_list_public(list_id)
    or public.is_list_collaborator(list_id)
  );

create policy "items_insert" on public.media_list_items for insert
  with check (
    public.is_list_owner(list_id)
    or public.is_list_collaborator(list_id)
  );

create policy "items_update" on public.media_list_items for update
  using (
    public.is_list_owner(list_id)
    or public.is_list_collaborator(list_id)
  );

create policy "items_delete" on public.media_list_items for delete
  using (
    public.is_list_owner(list_id)
    or public.is_list_collaborator(list_id)
  );

-- ─── media_list_votes policies ───────────────────────────────────────────────

create policy "votes_select" on public.media_list_votes for select
  using (
    exists (
      select 1 from public.media_list_items i
      where i.id = list_item_id
        and (
          public.is_list_owner(i.list_id)
          or public.is_list_public(i.list_id)
          or public.is_list_collaborator(i.list_id)
        )
    )
  );

create policy "votes_insert" on public.media_list_votes for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.media_list_items i
      where i.id = list_item_id
        and (
          public.is_list_owner(i.list_id)
          or public.is_list_public(i.list_id)
          or public.is_list_collaborator(i.list_id)
        )
    )
  );

create policy "votes_update" on public.media_list_votes for update
  using (user_id = auth.uid());

create policy "votes_delete" on public.media_list_votes for delete
  using (user_id = auth.uid());
