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
    const episodes = data?.episodes || [];
    let minutes = episodes.find((ep) => ep.episode_number === Number(episode))?.runtime;
    // TMDB often has no runtime for a single episode (common for anime): fall
    // back to the season's typical episode, then the show's, so a server
    // playing a different show is still caught (Vidy served a 47-min video
    // for a 21-min Fighting Spirit episode).
    if (!(minutes > 0)) {
      const known = episodes.map((ep) => ep.runtime).filter((r) => r > 0).sort((a, b) => a - b);
      minutes = known.length ? known[Math.floor(known.length / 2)] : null;
    }
    if (!(minutes > 0)) {
      const show = await tmdbGet(`/tv/${tmdbId}`).catch(() => null);
      minutes = (show?.episode_run_time || []).find((r) => r > 0);
    }
    return minutes > 0 ? minutes * 60 : null;
  }
  const data = await tmdbGet(`/movie/${tmdbId}`).catch(() => null);
  return data?.runtime > 0 ? data.runtime * 60 : null;
}
