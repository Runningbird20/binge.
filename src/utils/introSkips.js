// Skipping intros automatically, per show (the TV apps' IntroSkips): after
// you've pressed Skip intro on two different episodes of a show, the player
// offers to do it for you from then on. Binge mode (Settings) does it for
// every show. Only intros with a known timing are ever skipped.
const ON = 'binge:autoSkip:';
const SKIPPED = 'binge:introSkipped:';
const OFFERED = 'binge:autoSkipOffered:';

function store() {
  try { return window.localStorage; } catch { return null; }
}

export function isAutoSkipOn(showId) {
  return store()?.getItem(ON + showId) === '1';
}

export function setAutoSkip(showId, on) {
  const s = store();
  if (!s) return;
  if (on) s.setItem(ON + showId, '1'); else s.removeItem(ON + showId);
}

// A Skip intro press; returns how many different episodes it's been on.
export function recordManualSkip(showId, season, episode) {
  const s = store();
  if (!s) return 0;
  let seen = [];
  try { seen = JSON.parse(s.getItem(SKIPPED + showId) || '[]'); } catch { seen = []; }
  const tag = `${season}:${episode}`;
  if (!seen.includes(tag)) seen = [...seen, tag].slice(-50);
  s.setItem(SKIPPED + showId, JSON.stringify(seen));
  return seen.length;
}

// True once per show, after the second episode skipped by hand.
export function shouldOfferAutoSkip(showId, skips) {
  const s = store();
  if (!s || skips < 2 || isAutoSkipOn(showId) || s.getItem(OFFERED + showId)) return false;
  s.setItem(OFFERED + showId, '1');
  return true;
}
