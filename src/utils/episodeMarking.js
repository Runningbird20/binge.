// "Mark season watched" and "Watched up to here" in a series' episode list:
// which episodes a click covers, and where the show picks up afterwards.
// Episodes come from TMDB's season data ({ number, airDate }); seasons are
// the title's TMDB seasons ({ season_number, episode_count, air_date }).

export const episodeKey = (season, episode) => `${season}:${episode}`;

const hasAired = (airDate, now) => !airDate || new Date(airDate) <= now;

// Every episode of the season shown that has aired.
export function seasonEpisodes(season, episodes, now = new Date()) {
  return (episodes || [])
    .filter((entry) => hasAired(entry.airDate, now))
    .map((entry) => ({ season, episode: entry.number }));
}

// This episode and everything before it: earlier seasons in full (specials,
// season 0, aren't counted), then this season up to it.
export function episodesUpTo(seasons, season, episode) {
  const list = [];
  (seasons || [])
    .filter((entry) => entry.season_number > 0 && entry.season_number < season)
    .sort((a, b) => a.season_number - b.season_number)
    .forEach((entry) => {
      for (let number = 1; number <= entry.episode_count; number += 1) list.push({ season: entry.season_number, episode: number });
    });
  for (let number = 1; number <= episode; number += 1) list.push({ season, episode: number });
  return list;
}

// The ones not already marked.
export function unwatchedOnly(list, watched) {
  return list.filter((entry) => !watched.has(episodeKey(entry.season, entry.episode)));
}

export function isAfter(a, b) {
  if (!b) return true;
  return a.season > b.season || (a.season === b.season && a.episode > b.episode);
}

// The episode after `last`: the next one in its season if it has aired
// (`episodes` is that season's list), else episode 1 of the next season once
// it has started. null when there's nothing to watch next yet.
export function nextEpisode(last, seasons, episodes, now = new Date()) {
  const following = (episodes || []).find((entry) => entry.number === last.episode + 1);
  if (following) return hasAired(following.airDate, now) ? { season: last.season, episode: following.number } : null;
  const nextSeason = (seasons || [])
    .filter((entry) => entry.season_number > last.season && entry.episode_count > 0)
    .sort((a, b) => a.season_number - b.season_number)[0];
  if (!nextSeason || !hasAired(nextSeason.air_date, now)) return null;
  return { season: nextSeason.season_number, episode: 1 };
}

// TMDB numbers some shows' episodes from the start of the series, not the
// season: One Piece's season 22 is episodes 1089–1155, and the servers take
// those numbers ("season 22, episode 40" played an episode from 1999). So the
// next episode comes from the season's own list, never "+1", and a number that
// isn't in its season but fits its place (the 40th) is read as that place.
// `episodes` is the season's list ({ number }), in order.
export function realEpisodeNumber(episodes, episode) {
  if (!episodes?.length || episodes.some((entry) => entry.number === episode)) return episode;
  // Only a season numbered from the series' start (its first number past its
  // own length, 1089 in a 67-episode season) is read by place.
  if (episodes[0].number <= episodes.length) return episode;
  return episodes[episode - 1]?.number ?? episode;
}

// The number of the episode after `episode` in its season, or null at the end.
export function followingInSeason(episodes, episode) {
  const current = realEpisodeNumber(episodes, episode);
  return (episodes || []).find((entry) => entry.number > current)?.number ?? null;
}

// The latest episode in a list.
export function lastOf(list) {
  return list.reduce((latest, entry) => (isAfter(entry, latest) ? entry : latest), null);
}
