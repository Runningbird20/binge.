// Going back to the page a popup was opened from. One history.back() isn't
// always enough: an embedded video player's own navigations (a server's Next
// button, its own server picker) add entries to the same browser history, so a
// step back can land inside the player's iframe and leave the popup open.

// Where the popup started, read when it opens: the entry before it (Navigation
// API) and the history length.
export function historyMark() {
  const nav = window.navigation;
  const current = nav?.currentEntry;
  const previous = current && current.index > 0 ? nav.entries()[current.index - 1] : null;
  return { originKey: previous?.key ?? null, length: window.history.length };
}

// Back to that page: straight to its entry where the browser has the
// Navigation API, else back past every entry added since the popup opened.
export function goBackTo(mark) {
  const nav = window.navigation;
  if (mark?.originKey && nav?.entries().some((entry) => entry.key === mark.originKey)) {
    const result = nav.traverseTo(mark.originKey);
    result?.committed?.catch?.(() => {});
    result?.finished?.catch?.(() => {});
    return;
  }
  const added = mark ? Math.max(0, window.history.length - mark.length) : 0;
  window.history.go(-(1 + added));
}
