// Spoiler-free episodes (Settings › Browsing, off by default): an episode past
// the profile's progress in a show shows a blurred picture and no summary
// until it's asked for (EpisodeList), and the player's Up Next card blurs the
// next episode's picture. Progress is the later of the furthest episode
// marked watched and where the show resumes; episodes up to it, and any
// watched one, show as usual. A show not started has no progress: every
// episode is past it.
import { episodeKey } from './episodeMarking';

const later = (a, b) => (!b || a.season > b.season || (a.season === b.season && a.episode > b.episode) ? a : b);

// { season, episode } or null. watched holds "season:episode" keys.
export function progressPoint(watched, resumeAt = null) {
  let point = resumeAt?.season ? { season: Number(resumeAt.season), episode: Number(resumeAt.episode) || 1 } : null;
  (watched || []).forEach((key) => {
    const [season, episode] = String(key).split(':').map(Number);
    if (season > 0 && episode > 0) point = later({ season, episode }, point);
  });
  return point;
}

export function isSpoiler(season, episode, watched, progress) {
  if (watched?.has(episodeKey(season, episode))) return false;
  if (!progress) return true;
  return season > progress.season || (season === progress.season && episode > progress.episode);
}
