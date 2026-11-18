export const STATUS_LABELS = {
  plan_to_watch: 'Plan to Watch',
  watching: 'Watching',
  watched: 'Watched',
};

export function getStatusOptions(mediaType) {
  if (mediaType === 'tv_show') return ['plan_to_watch', 'watching', 'watched'];
  return ['plan_to_watch', 'watched'];
}
