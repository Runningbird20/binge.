// "2 episodes left in Season 3", "Season finale next", "New season Friday"
// for a show in Continue Watching, from TMDB's /tv/{id} details and the
// episode the viewer is on.

function parseDay(date) {
  if (!date) return null;
  const at = new Date(`${date}T12:00:00`);
  return Number.isNaN(at.getTime()) ? null : at;
}

// "today", "tomorrow", "Friday" within a week, else "Oct 24".
export function friendlyDay(date, now = new Date()) {
  const at = parseDay(date);
  if (!at) return null;
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(at) - startOf(now)) / 86400000);
  if (days < 0) return null;
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 7) return at.toLocaleDateString('en-US', { weekday: 'long' });
  return at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function seasonStatus(details, season, episode, now = new Date()) {
  if (!details || !(season > 0) || !(episode > 0)) return null;
  const seasons = (details.seasons || []).filter((s) => s.season_number > 0);
  const current = seasons.find((s) => s.season_number === season);
  const next = details.next_episode_to_air;
  const nextDay = next ? friendlyDay(next.air_date, now) : null;

  // Episodes of this season that have aired so far.
  let aired = current?.episode_count || 0;
  if (next && next.season_number === season) aired = Math.min(aired || Infinity, next.episode_number - 1);
  const left = aired - episode;

  if (left >= 2) return `${left} episodes left in Season ${season}`;
  if (left === 1) {
    const finale = !next || next.season_number > season || (current?.episode_count && current.episode_count === aired);
    return finale ? 'Season finale next' : '1 episode left so far';
  }
  // At the newest aired episode of this season.
  if (next && next.season_number === season && nextDay) return `Next episode ${nextDay}`;
  if (next && next.season_number > season && nextDay) {
    return next.episode_number === 1 ? `Season ${next.season_number} starts ${nextDay}` : `New episode ${nextDay}`;
  }
  const later = seasons.find((s) => s.season_number > season && s.episode_count > 0 && parseDay(s.air_date) && parseDay(s.air_date) <= now);
  if (later) return `Season ${later.season_number} is out`;
  if (details.status === 'Ended' || details.status === 'Canceled') return 'Series finale';
  return null;
}
