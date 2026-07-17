// Shared helpers for surfacing watch/read progress (season/episode or
// page/chapter) wherever a title can show it: Home's Continue Watching row,
// the watchlist grid, and the media details modal.

export function detailsUrl(item) {
  if (item.media_type === 'movie') return `/movie/${item.media_id}`;
  if (item.media_type === 'tv_show') return `/tv-show/${item.media_id}`;
  if (item.media_type === 'book') return `/book/${item.media_id}`;
  return '/home';
}

export function resumeUrl(item) {
  if (item.media_type === 'movie') return `/movie/${item.media_id}?play=1`;
  if (item.media_type === 'tv_show') {
    const params = new URLSearchParams({ play: '1' });
    if (item.current_season) params.set('season', item.current_season);
    if (item.current_episode) params.set('episode', item.current_episode);
    return `/tv-show/${item.media_id}?${params.toString()}`;
  }
  return detailsUrl(item);
}

// item is anything carrying current_season/current_episode/current_chapter/
// current_page (a watchlist row or a continue_watching row).
export function computeProgressBadge(item) {
  if (!item) return null;

  const s = item.current_season;
  const e = item.current_episode;
  const ch = item.current_chapter;
  const pg = item.current_page;

  if (item.media_type === 'tv_show' && (s || e)) {
    return `S${s || 1} · E${e || 1}`;
  }
  if (item.media_type === 'book' && (ch || pg)) {
    return ch ? `Ch ${ch}` : `Pg ${pg}`;
  }
  return null;
}
