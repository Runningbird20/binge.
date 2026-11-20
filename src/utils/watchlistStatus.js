export const STATUS_LABELS = {
  plan_to_watch: 'Plan to Watch',
  watching: 'Watching',
  watched: 'Watched',
};

// Movies and series alike: starting either puts it on the list as Watching.
export function getStatusOptions() {
  return ['plan_to_watch', 'watching', 'watched'];
}
