// Which sports feeds have worked for this viewer, so the player starts on
// the likeliest one. Cross-origin players can't say whether they're
// playing, so "worked" means the viewer stayed on it for a minute and
// "failed" means it didn't load or they moved on within that minute.
//
// Kept per feed family (Streamed · admin, PPV · SkyCast, StreamFree 1080p),
// which carries over between games, plus the server that last worked for
// each game.

const KEY = 'binge.sportsFeeds.v1';
const HALF_LIFE_DAYS = 10;
const MAX_GAMES = 60;

function read() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { feeds: parsed.feeds || {}, games: parsed.games || {} };
  } catch {
    return { feeds: {}, games: {} };
  }
}

function write(data) {
  try {
    const games = Object.entries(data.games).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_GAMES);
    localStorage.setItem(KEY, JSON.stringify({ feeds: data.feeds, games: Object.fromEntries(games) }));
  } catch { /* storage unavailable */ }
}

// "Streamed · admin 2 HD · English" and "Streamed · admin 1 HD" share a family.
export function feedFamily(provider) {
  if (!provider) return '';
  if (provider.id === 'streamed') return `streamed:${provider.source || ''}`;
  if (provider.id === 'ppv') return `ppv:${(provider.label || '').replace(/^PPV ·?\s*/, '').toLowerCase()}`;
  return `${provider.id}:${(provider.label || '').toLowerCase()}`;
}

function decayed(entry, now) {
  if (!entry) return 0;
  const days = (now - entry.at) / 86400000;
  return entry.score * 0.5 ** (days / HALF_LIFE_DAYS);
}

function record(provider, gameId, delta, now = Date.now()) {
  const family = feedFamily(provider);
  if (!family) return;
  const data = read();
  data.feeds[family] = { score: Math.max(-5, Math.min(10, decayed(data.feeds[family], now) + delta)), at: now };
  if (gameId && delta > 0 && provider.embedUrl) data.games[gameId] = { url: provider.embedUrl, at: now };
  if (gameId && delta < 0 && data.games[gameId]?.url === provider.embedUrl) delete data.games[gameId];
  write(data);
}

export function recordFeedWorked(provider, gameId) { record(provider, gameId, 1); }
export function recordFeedFailed(provider, gameId) { record(provider, gameId, -1); }

// Stable order: the server that last worked for this game, then feed
// families by how well they've worked lately, then the original order
// (which is already HD-first within each Streamed source).
export function rankFeeds(providers, gameId, now = Date.now()) {
  const data = read();
  const last = gameId ? data.games[gameId]?.url : null;
  return providers
    .map((provider, index) => ({
      provider,
      index,
      last: last && provider.embedUrl === last ? 1 : 0,
      score: decayed(data.feeds[feedFamily(provider)], now),
    }))
    .sort((a, b) => b.last - a.last || b.score - a.score || a.index - b.index)
    .map((entry) => entry.provider);
}
