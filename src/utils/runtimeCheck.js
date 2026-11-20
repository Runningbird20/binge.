// Catches a server playing a different video under the right id: its
// length is far from the title's real runtime (TMDB). Measured: Vidy served
// a 98-minute video for Demon Slayer: Infinity Castle (156 min) while
// VidRift (154) and CineSrc (155) had the right one.
import { tmdbGet } from './tmdb';

//
// False alarms (2026-11-19: "it said a different video, but it was the
// right one") came from judging too early or on a guess:
//   - one reading was enough, and players report a pre-roll's or a part-loaded
//     stream's length before the film's (RuntimeWatch waits for 30s of
//     playback and the same length 10s apart);
//   - an episode without its own TMDB runtime was held to the season's
//     typical length, which a double-length finale fails (estimates get a
//     wider margin).
// An expected runtime is { seconds, estimated } (a bare number still works).
export function isWrongLength(durationSeconds, expected) {
  const seconds = typeof expected === 'number' ? expected : expected?.seconds;
  if (!(durationSeconds > 60) || !(seconds > 0)) return false;
  // A guess (the season's typical episode) only catches a video of another
  // size: under half or over 1.8 times. A 70-min finale among 45-min
  // episodes passes; Vidy's 47-min video for a 21-min episode doesn't.
  if (expected?.estimated) return durationSeconds < seconds * 0.5 || durationSeconds > seconds * 1.8;
  return Math.abs(durationSeconds - seconds) > Math.max(240, seconds * 0.2);
}

const SETTLE_PLAYED_S = 30;
const SETTLE_STEADY_MS = 10_000;

// Decides once per load, from readings: { duration, time, at (ms) }. Returns
// 'wrong' or 'right' once settled, null while it's still too early to say.
export function createRuntimeWatch() {
  let first = null;
  let verdict = null;
  return {
    note(reading, expected) {
      if (verdict) return verdict;
      const { duration, time, at } = reading;
      if (!(duration > 60) || !(time >= SETTLE_PLAYED_S) || !expected) return null;
      if (!first || Math.abs(first.duration - duration) > 2) { first = { duration, at }; return null; }
      if (at - first.at < SETTLE_STEADY_MS) return null;
      verdict = isWrongLength(duration, expected) ? 'wrong' : 'right';
      return verdict;
    },
  };
}

// Two servers playing the same length (within 3%, or a minute) are both
// right and TMDB's runtime is off (the Apple TV app's ExpectedRuntime.agree).
export function lengthsAgree(duration, others) {
  return others.some((other) => Math.abs(other - duration) <= Math.max(60, duration * 0.03));
}

// "1h 38m" for a notice.
export function formatLength(seconds) {
  const m = Math.round(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m} min`;
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
    let estimated = false;
    if (!(minutes > 0)) {
      const known = episodes.map((ep) => ep.runtime).filter((r) => r > 0).sort((a, b) => a - b);
      minutes = known.length ? known[Math.floor(known.length / 2)] : null;
      estimated = true;
    }
    if (!(minutes > 0)) {
      const show = await tmdbGet(`/tv/${tmdbId}`).catch(() => null);
      minutes = (show?.episode_run_time || []).find((r) => r > 0);
    }
    return minutes > 0 ? { seconds: minutes * 60, estimated } : null;
  }
  const data = await tmdbGet(`/movie/${tmdbId}`).catch(() => null);
  return data?.runtime > 0 ? { seconds: data.runtime * 60, estimated: false } : null;
}
