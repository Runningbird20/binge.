// People: a title's cast & crew (the photo row in the title popup) and a
// person's work (/person/:id), from TMDB matched back to the catalog like
// the browse rows (release window and the profile's maturity level apply).
import { normalizeTmdbResult, tmdbGet, tmdbImage } from './tmdb';
import { resolveTmdbItems } from './catalogLookup';

// Not real roles: guest spots as themselves, hosting, narration.
const NON_ROLES = /\b(self|himself|herself|themselves|host|narrator|presenter|guest)\b/i;
// Talk, news and reality shows.
const UNSCRIPTED = [10767, 10763, 10764];

// A title's people for the photo row: its directors (movies) or creators
// (series) first, then the top-billed cast. Each person once.
export function titlePeople(details, mediaType, { cast: castLimit = 20 } = {}) {
  const crew = mediaType === 'tv_show'
    ? (details?.created_by || []).map((person) => ({ ...person, role: 'Creator' }))
    : (details?.credits?.crew || []).filter((person) => person.job === 'Director').map((person) => ({ ...person, role: 'Director' }));
  const cast = (details?.credits?.cast || [])
    .slice()
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
    .slice(0, castLimit)
    .map((person) => ({ ...person, role: person.character || '' }));
  const seen = new Set();
  return [...crew, ...cast]
    .filter((person) => person?.id && person.name && !seen.has(person.id) && seen.add(person.id))
    .map((person) => ({
      id: person.id,
      name: person.name,
      role: String(person.role || '').split(' / ')[0].trim(),
      photo: tmdbImage(person.profile_path, 'w185'),
    }));
}

// Someone's credits that are their work, most widely known first (vote
// count, so a hit film comes before a talk-show appearance), each title once.
// Acting: real roles only, scripted, and for series at least 3 episodes
// (no one-episode cameos). Crew: directing (movies) and creating (series).
export function workCredits(credits) {
  const keep = (list) => {
    const seen = new Set();
    return list
      .filter((credit) => credit.media_type === 'movie' || credit.media_type === 'tv')
      .sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0))
      .filter((credit) => {
        const key = `${credit.media_type}:${credit.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  };
  const acting = keep((credits?.cast || []).filter((credit) => !NON_ROLES.test(credit.character || '')
    && !(credit.genre_ids || []).some((id) => UNSCRIPTED.includes(id))
    && (credit.media_type !== 'tv' || (credit.episode_count || 0) >= 3)));
  // Directing a film, or creating a series (directing an episode isn't
  // their work in the same sense: Robert Downey Jr. directed one Twilight Zone).
  const directing = keep((credits?.crew || []).filter((credit) => (credit.job === 'Director' && credit.media_type === 'movie') || credit.job === 'Creator'));
  return { acting, directing };
}

// Catalog rows for TMDB credits, in the credits' order: movies and series.
async function onBinge(credits, kidsSafe) {
  const results = credits.map((credit) => normalizeTmdbResult(credit));
  const [movies, shows] = await Promise.all([
    resolveTmdbItems(results.filter((result) => result.mediaType === 'movie'), 'movie', { kidsSafe }),
    resolveTmdbItems(results.filter((result) => result.mediaType === 'tv_show'), 'tv_show', { kidsSafe }),
  ]);
  const rank = new Map(results.map((result, index) => [`${result.mediaType}:${result.tmdbId}`, index]));
  const position = (item) => rank.get(`${item.media_type}:${item._tmdb?.tmdbId}`) ?? Infinity;
  return { movies, shows, all: [...movies, ...shows].sort((a, b) => position(a) - position(b)) };
}

// The person page: who they are and their work on binge., as rows.
// → { person, rows: [{ id, title, items }] } or null when TMDB doesn't know them.
export async function fetchPerson(id, { kidsSafe = false } = {}) {
  const data = await tmdbGet(`/person/${id}`, { append_to_response: 'combined_credits' });
  if (!data?.id) return null;
  const { acting, directing } = workCredits(data.combined_credits);
  const [acted, directed] = await Promise.all([onBinge(acting.slice(0, 80), kidsSafe), onBinge(directing.slice(0, 40), kidsSafe)]);
  const directs = data.known_for_department === 'Directing' || data.known_for_department === 'Writing';
  const madeTitle = directed.movies.length && directed.shows.length
    ? `Directed and created by ${data.name}`
    : directed.shows.length ? `Created by ${data.name}` : `Directed by ${data.name}`;
  const crewRow = { id: 'directed', title: madeTitle, items: directed.all };
  const actingRows = [
    { id: 'movies', title: `Movies with ${data.name}`, items: acted.movies },
    { id: 'series', title: `Series with ${data.name}`, items: acted.shows },
  ];
  const rows = (directs ? [crewRow, ...actingRows] : [...actingRows, crewRow]).filter((row) => row.items.length);
  return {
    person: {
      id: data.id,
      name: data.name,
      photo: tmdbImage(data.profile_path, 'h632'),
      department: departmentLabel(data.known_for_department),
      biography: data.biography || '',
      birthday: data.birthday || null,
      deathday: data.deathday || null,
      placeOfBirth: data.place_of_birth || null,
    },
    rows,
  };
}

function departmentLabel(department) {
  if (department === 'Acting') return 'Actor';
  if (department === 'Directing') return 'Director';
  if (department === 'Writing') return 'Writer';
  if (department === 'Production') return 'Producer';
  return department || '';
}

// "Born March 1, 1965 in Los Angeles, California, USA" / "1932 – 2021".
export function lifeLine(person, now = new Date()) {
  const date = (value) => {
    const d = value ? new Date(`${value}T00:00:00`) : null;
    return d && !Number.isNaN(d.getTime()) ? d : null;
  };
  const born = date(person?.birthday);
  const died = date(person?.deathday);
  const format = (d) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  if (born && died) return `${born.getFullYear()} – ${died.getFullYear()}`;
  if (!born) return person?.placeOfBirth ? `Born in ${person.placeOfBirth}` : '';
  let age = now.getFullYear() - born.getFullYear();
  if (now.getMonth() < born.getMonth() || (now.getMonth() === born.getMonth() && now.getDate() < born.getDate())) age -= 1;
  return `Born ${format(born)}${person.placeOfBirth ? ` in ${person.placeOfBirth}` : ''} (age ${age})`;
}
