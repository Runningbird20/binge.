// Small text helpers shared by the title popup (MediaDetailsModal) and its parts.

export function splitList(value) {
  return String(value || '').split(',').map((entry) => entry.trim()).filter(Boolean);
}

export function formatRuntime(minutes) {
  if (!minutes) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}
