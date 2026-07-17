export const STATUS_LABELS = {
  plan_to_watch: 'Plan to Watch',
  watching: 'Watching',
  watched: 'Watched',
  plan_to_read: 'Plan to Read',
  reading: 'Reading',
  read: 'Read',
};

export function getStatusOptions(mediaType) {
  if (mediaType === 'tv_show') return ['plan_to_watch', 'watching', 'watched'];
  if (mediaType === 'book') return ['plan_to_read', 'reading', 'read'];
  return ['plan_to_watch', 'watched'];
}
