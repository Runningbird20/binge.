-- Resume position synced across devices: where the viewer stopped in the
-- title's current episode (or the movie), so opening it on another device
-- starts at the same second. Written by the player every ~30s and on close.
alter table public.continue_watching
  add column if not exists position_seconds integer check (position_seconds is null or position_seconds >= 0),
  add column if not exists duration_seconds integer check (duration_seconds is null or duration_seconds >= 0);
