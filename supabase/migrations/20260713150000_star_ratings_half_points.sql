-- Widen movie/tv_show/book rating columns from integer to numeric(2,1) so
-- half-star values (e.g. 4.5) can be stored — the app now collects a
-- single 5-star (half-star precision) rating and writes the same value
-- across every category column for that media type. Existing whole-number
-- ratings are preserved as-is by the type widening.
--
-- Also standardizes every check constraint to 1-5 (a couple of columns —
-- tv_show_ratings.acting/writing/resonance and book_ratings.characters/
-- resonance — had a pre-existing "between 1 and 6" typo that never matched
-- the app's RATING_CATEGORIES, which are all max:5).

-- ── movie_ratings ────────────────────────────────────────────────────────
alter table public.movie_ratings
  alter column acting type numeric(2,1),
  alter column writing type numeric(2,1),
  alter column originality type numeric(2,1),
  alter column pacing type numeric(2,1),
  alter column cinematography type numeric(2,1);

alter table public.movie_ratings drop constraint if exists movie_ratings_acting_check;
alter table public.movie_ratings drop constraint if exists movie_ratings_writing_check;
alter table public.movie_ratings drop constraint if exists movie_ratings_originality_check;
alter table public.movie_ratings drop constraint if exists movie_ratings_pacing_check;
alter table public.movie_ratings drop constraint if exists movie_ratings_cinematography_check;

alter table public.movie_ratings
  add constraint movie_ratings_acting_check check (acting between 1 and 5 and acting * 2 = floor(acting * 2)),
  add constraint movie_ratings_writing_check check (writing between 1 and 5 and writing * 2 = floor(writing * 2)),
  add constraint movie_ratings_originality_check check (originality between 1 and 5 and originality * 2 = floor(originality * 2)),
  add constraint movie_ratings_pacing_check check (pacing between 1 and 5 and pacing * 2 = floor(pacing * 2)),
  add constraint movie_ratings_cinematography_check check (cinematography between 1 and 5 and cinematography * 2 = floor(cinematography * 2));

-- ── tv_show_ratings ──────────────────────────────────────────────────────
alter table public.tv_show_ratings
  alter column premise type numeric(2,1),
  alter column originality type numeric(2,1),
  alter column acting type numeric(2,1),
  alter column cinematography type numeric(2,1),
  alter column writing type numeric(2,1),
  alter column pacing type numeric(2,1),
  alter column resonance type numeric(2,1);

alter table public.tv_show_ratings drop constraint if exists tv_show_ratings_premise_check;
alter table public.tv_show_ratings drop constraint if exists tv_show_ratings_originality_check;
alter table public.tv_show_ratings drop constraint if exists tv_show_ratings_acting_check;
alter table public.tv_show_ratings drop constraint if exists tv_show_ratings_cinematography_check;
alter table public.tv_show_ratings drop constraint if exists tv_show_ratings_writing_check;
alter table public.tv_show_ratings drop constraint if exists tv_show_ratings_pacing_check;
alter table public.tv_show_ratings drop constraint if exists tv_show_ratings_resonance_check;

alter table public.tv_show_ratings
  add constraint tv_show_ratings_premise_check check (premise between 1 and 5 and premise * 2 = floor(premise * 2)),
  add constraint tv_show_ratings_originality_check check (originality between 1 and 5 and originality * 2 = floor(originality * 2)),
  add constraint tv_show_ratings_acting_check check (acting between 1 and 5 and acting * 2 = floor(acting * 2)),
  add constraint tv_show_ratings_cinematography_check check (cinematography between 1 and 5 and cinematography * 2 = floor(cinematography * 2)),
  add constraint tv_show_ratings_writing_check check (writing between 1 and 5 and writing * 2 = floor(writing * 2)),
  add constraint tv_show_ratings_pacing_check check (pacing between 1 and 5 and pacing * 2 = floor(pacing * 2)),
  add constraint tv_show_ratings_resonance_check check (resonance between 1 and 5 and resonance * 2 = floor(resonance * 2));

-- ── book_ratings ─────────────────────────────────────────────────────────
alter table public.book_ratings
  alter column prose type numeric(2,1),
  alter column plot type numeric(2,1),
  alter column characters type numeric(2,1),
  alter column originality type numeric(2,1),
  alter column pacing type numeric(2,1),
  alter column resonance type numeric(2,1);

alter table public.book_ratings drop constraint if exists book_ratings_prose_check;
alter table public.book_ratings drop constraint if exists book_ratings_plot_check;
alter table public.book_ratings drop constraint if exists book_ratings_characters_check;
alter table public.book_ratings drop constraint if exists book_ratings_originality_check;
alter table public.book_ratings drop constraint if exists book_ratings_pacing_check;
alter table public.book_ratings drop constraint if exists book_ratings_resonance_check;

alter table public.book_ratings
  add constraint book_ratings_prose_check check (prose between 1 and 5 and prose * 2 = floor(prose * 2)),
  add constraint book_ratings_plot_check check (plot between 1 and 5 and plot * 2 = floor(plot * 2)),
  add constraint book_ratings_characters_check check (characters between 1 and 5 and characters * 2 = floor(characters * 2)),
  add constraint book_ratings_originality_check check (originality between 1 and 5 and originality * 2 = floor(originality * 2)),
  add constraint book_ratings_pacing_check check (pacing between 1 and 5 and pacing * 2 = floor(pacing * 2)),
  add constraint book_ratings_resonance_check check (resonance between 1 and 5 and resonance * 2 = floor(resonance * 2));
