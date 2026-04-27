-- RLS policies for media_lists, media_list_collaborators, media_list_items, media_list_votes
-- All four tables have RLS enabled but no policies, which blocks all client-side access.

-- ─── media_lists ─────────────────────────────────────────────────────────────

-- Owner sees their lists; collaborators see lists they're on; anyone sees public lists
create policy "lists_select"
  on public.media_lists for select
  using (
    user_id = auth.uid()
    or is_public = true
    or exists (
      select 1 from public.media_list_collaborators c
      where c.list_id = id and c.user_id = auth.uid()
    )
  );

-- Authenticated users can create lists they own
create policy "lists_insert"
  on public.media_lists for insert
  with check (user_id = auth.uid());

-- Only the owner can rename / toggle public
create policy "lists_update"
  on public.media_lists for update
  using (user_id = auth.uid());

-- Only the owner can delete the list
create policy "lists_delete"
  on public.media_lists for delete
  using (user_id = auth.uid());


-- ─── media_list_collaborators ─────────────────────────────────────────────────

-- Collaborator sees their own row; list owner sees all collaborators on their list;
-- other collaborators of the same list can see each other
create policy "collab_select"
  on public.media_list_collaborators for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.media_lists l
      where l.id = list_id and l.user_id = auth.uid()
    )
    or exists (
      select 1 from public.media_list_collaborators c2
      where c2.list_id = list_id and c2.user_id = auth.uid()
    )
  );

-- Only the list owner can add collaborators
create policy "collab_insert"
  on public.media_list_collaborators for insert
  with check (
    exists (
      select 1 from public.media_lists l
      where l.id = list_id and l.user_id = auth.uid()
    )
  );

-- List owner can remove anyone; a collaborator can remove themselves
create policy "collab_delete"
  on public.media_list_collaborators for delete
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.media_lists l
      where l.id = list_id and l.user_id = auth.uid()
    )
  );


-- ─── media_list_items ────────────────────────────────────────────────────────

-- Owner, collaborator, or viewer of a public list can read items
create policy "items_select"
  on public.media_list_items for select
  using (
    exists (
      select 1 from public.media_lists l
      where l.id = list_id and (
        l.user_id = auth.uid()
        or l.is_public = true
        or exists (
          select 1 from public.media_list_collaborators c
          where c.list_id = l.id and c.user_id = auth.uid()
        )
      )
    )
  );

-- Owner or collaborator can add items
create policy "items_insert"
  on public.media_list_items for insert
  with check (
    exists (
      select 1 from public.media_lists l
      where l.id = list_id and (
        l.user_id = auth.uid()
        or exists (
          select 1 from public.media_list_collaborators c
          where c.list_id = l.id and c.user_id = auth.uid()
        )
      )
    )
  );

-- Owner or collaborator can reorder items
create policy "items_update"
  on public.media_list_items for update
  using (
    exists (
      select 1 from public.media_lists l
      where l.id = list_id and (
        l.user_id = auth.uid()
        or exists (
          select 1 from public.media_list_collaborators c
          where c.list_id = l.id and c.user_id = auth.uid()
        )
      )
    )
  );

-- Owner or collaborator can remove items
create policy "items_delete"
  on public.media_list_items for delete
  using (
    exists (
      select 1 from public.media_lists l
      where l.id = list_id and (
        l.user_id = auth.uid()
        or exists (
          select 1 from public.media_list_collaborators c
          where c.list_id = l.id and c.user_id = auth.uid()
        )
      )
    )
  );


-- ─── media_list_votes ────────────────────────────────────────────────────────

-- Anyone who can see the list can read votes on its items
create policy "votes_select"
  on public.media_list_votes for select
  using (
    exists (
      select 1
      from public.media_list_items i
      join public.media_lists l on l.id = i.list_id
      where i.id = list_item_id and (
        l.user_id = auth.uid()
        or l.is_public = true
        or exists (
          select 1 from public.media_list_collaborators c
          where c.list_id = l.id and c.user_id = auth.uid()
        )
      )
    )
  );

-- Authenticated users can vote on items they can see; must own the vote row
create policy "votes_insert"
  on public.media_list_votes for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.media_list_items i
      join public.media_lists l on l.id = i.list_id
      where i.id = list_item_id and (
        l.user_id = auth.uid()
        or l.is_public = true
        or exists (
          select 1 from public.media_list_collaborators c
          where c.list_id = l.id and c.user_id = auth.uid()
        )
      )
    )
  );

-- Users can change their own votes
create policy "votes_update"
  on public.media_list_votes for update
  using (user_id = auth.uid());

-- Users can delete their own votes
create policy "votes_delete"
  on public.media_list_votes for delete
  using (user_id = auth.uid());
