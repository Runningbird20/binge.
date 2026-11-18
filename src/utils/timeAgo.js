// "5 min ago", for every "when did this happen" label: the notification bell
// and the admin panels. Lowercase, since most callers put it mid-sentence
// ("Checked just now."); a label that stands alone capitalizes it itself.
// A time slightly in the future (a clock ahead of the server's) reads
// "just now", and a missing or unreadable time reads "never".
export function timeAgo(iso, now = Date.now()) {
  const then = iso ? new Date(iso).getTime() : NaN;
  if (Number.isNaN(then)) return 'never';
  const minutes = Math.max(0, Math.round((now - then) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}
