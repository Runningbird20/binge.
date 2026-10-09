// Catches a server playing a different video under the right id: its
// length is far from the title's real runtime (TMDB). Measured: Vidy served
// a 98-minute video for Demon Slayer: Infinity Castle (156 min) while
// VidRift (154) and CineSrc (155) had the right one.
import { tmdbGet } from './tmdb';

export function isWrongLength(durationSeconds, expectedSeconds) {
  if (!(durationSeconds > 60) || !(expectedSeconds > 0)) return false;
  return Math.abs(durationSeconds - expectedSeconds) > Math.max(240, expectedSeconds * 0.2);
}

export async function expectedRuntimeSeconds({ tmdbId, mediaType, season, episode }) {
  if (!tmdbId) return null;
  if (mediaType === 'tv_show') {
    const data = await tmdbGet(`/tv/${tmdbId}/season/${season}`).catch(() => null);
    const minutes = data?.episodes?.find((ep) => ep.episode_number === Number(episode))?.runtime;
    return minutes > 0 ? minutes * 60 : null;
  }
  const data = await tmdbGet(`/movie/${tmdbId}`).catch(() => null);
  return data?.runtime > 0 ? data.runtime * 60 : null;
}
