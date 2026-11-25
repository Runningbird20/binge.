// Which AniList entry and episode a TMDB title is, for the anime server
// (AniXo finds a show by its AniList id). The map is public/anime-map.json,
// written by scripts/generate-anime-map.js from Fribb's anime-lists; the TV
// apps read the same file. Loaded once, on the first anime-looking title.
//
// Sub or dub: the profile's default (Settings › Anime), else per show what was
// last picked in the player.
import { getSettings } from './profileSettings';
import { getActiveProfileId } from './activeProfile';

let mapPromise = null;

export function loadAnimeMap() {
  if (!mapPromise) {
    mapPromise = fetch('/anime-map.json')
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null)
      .then((map) => {
        if (!map) mapPromise = null; // try again next time, never remember a failure
        return map;
      });
  }
  return mapPromise;
}

// { id, episode } for TMDB `tmdbId` (season, episode), or null when it isn't
// anime. A season split over several AniList entries (Frieren's season 1 holds
// three) is matched by the entry's episode offset; a show whose AniList entry
// runs the series' own numbers (One Piece) only for a season numbered that way
// too, or its first season.
export function animeEpisode(map, mediaType, tmdbId, season, episode, { seriesNumbered = false } = {}) {
  if (!map || !tmdbId) return null;
  if (mediaType !== 'tv_show') {
    const id = map.movie?.[tmdbId];
    return id ? { id, episode: 1 } : null;
  }
  const rows = map.tv?.[tmdbId];
  if (!rows?.length) return null;
  const s = Number(season) || 1;
  const e = Number(episode) || 1;
  const part = rows.find(([rowSeason, , offset]) => rowSeason === s && e > offset);
  if (part) return { id: part[1], episode: e - part[2] };
  const whole = rows.find(([rowSeason]) => rowSeason === -1);
  if (whole && (s === 1 || seriesNumbered)) return { id: whole[1], episode: e };
  return null;
}

const TRACK_KEY = 'binge:anime-track:';

export function animeTrackFor(itemId) {
  try {
    const saved = window.localStorage.getItem(`${TRACK_KEY}${getActiveProfileId() || 'default'}:${itemId}`);
    if (saved === 'sub' || saved === 'dub') return saved;
  } catch { /* private mode */ }
  return getSettings().animeTrack === 'dub' ? 'dub' : 'sub';
}

export function rememberAnimeTrack(itemId, track) {
  try { window.localStorage.setItem(`${TRACK_KEY}${getActiveProfileId() || 'default'}:${itemId}`, track); } catch { /* private mode */ }
}
