// Request completion, not elapsed time or download bytes.
const listeners = new Set();
let snapshot = { total: 0, completed: 0, active: 0 };
let resetTimer;
function publish(next) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}
export function subscribeLoading(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function getLoadingProgress() { return snapshot; }
export async function trackedFetch(...args) {
  clearTimeout(resetTimer);
  publish({ total: snapshot.total + 1, completed: snapshot.completed, active: snapshot.active + 1 });
  try {
    return await fetch(...args);
  } finally {
    const next = { ...snapshot, completed: snapshot.completed + 1, active: snapshot.active - 1 };
    publish(next);
    if (!next.active) resetTimer = setTimeout(() => publish({ total: 0, completed: 0, active: 0 }), 300);
  }
}
