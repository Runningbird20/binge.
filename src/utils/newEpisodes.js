// Shows in the profile's list / Continue Watching whose latest aired
// episode is beyond where the viewer is — the "New Episodes" row and the
// "New Episode" badge.
import { tmdbGet, tmdbIdFromItem } from './tmdb';

const NEW_WINDOW_DAYS = 21;

function isAfter(a, b) {
  return a.season > b.season || (a.season === b.season && a.episode > b.episode);
}

export async function findNewEpisodes({ watchlist = [], continueWatching = [] }) {
  const shows = new Map();
  continueWatching.filter((row) => row.media_type === 'tv_show').forEach((row) => shows.set(Number(row.media_id), {
    ...row,
    at: { season: Number(row.current_season) || 1, episode: Number(row.current_episode) || 1 },
  }));
  watchlist.filter((row) => row.media_type === 'tv_show' && row.status !== 'watched').forEach((row) => {
    const id = Number(row.media_id);
    if (!shows.has(id)) {
      shows.set(id, { ...row, at: { season: Number(row.current_season) || 0, episode: Number(row.current_episode) || 0 } });
    }
  });

  const cutoff = Date.now() - NEW_WINDOW_DAYS * 86400000;
  const results = await Promise.all([...shows.values()].slice(0, 40).map(async (row) => {
    const tmdbId = tmdbIdFromItem(row);
    if (!tmdbId) return null;
    const data = await tmdbGet(`/tv/${tmdbId}`);
    const last = data?.last_episode_to_air;
    if (!last?.air_date || new Date(`${last.air_date}T12:00:00`).getTime() < cutoff) return null;
    const latest = { season: last.season_number, episode: last.episode_number };
    if (!isAfter(latest, row.at)) return null;
    return {
      ...row,
      id: Number(row.media_id),
      media_type: 'tv_show',
      poster_url: row.poster_url || row.image_url,
      current_season: latest.season,
      current_episode: latest.episode,
      _badge: 'New Episode',
      _subtitle: `S${latest.season} · E${latest.episode} out ${new Date(`${last.air_date}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })}`,
      _airedAt: last.air_date,
    };
  }));
  return results.filter(Boolean).sort((a, b) => String(b._airedAt).localeCompare(String(a._airedAt)));
}
