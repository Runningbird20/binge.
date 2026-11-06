// The Sports page's rows: one per league, in a fixed league order.
import { getStatus } from './gameInfo';

// League rows, in the order a US-centric sports home would show them; any
// league not listed follows, biggest first.
const LEAGUE_ORDER = [
  'NFL', 'College Football', 'NBA', 'WNBA', 'NHL', 'MLB', 'MLS', 'Premier League', 'LaLiga', 'Champions League',
  'Serie A', 'Bundesliga', 'Ligue 1', 'Liga MX', 'Formula 1', 'UFC', 'Wrestling', 'Combat Sports',
];

export function sortForRow(streams, nowMs) {
  const rank = { live: 0, upcoming: 1, final: 2, replay: 3 };
  return [...streams].sort((a, b) => {
    const statusDiff = rank[getStatus(a, nowMs)] - rank[getStatus(b, nowMs)];
    if (statusDiff) return statusDiff;
    if (getStatus(a, nowMs) === 'live') {
      // Close games first, then games ESPN confirms are on, then the
      // best-served ones.
      const close = Number(Boolean(b.score?.close)) - Number(Boolean(a.score?.close));
      if (close) return close;
      const on = Number(b.score?.state === 'in') - Number(a.score?.state === 'in');
      if (on) return on;
    }
    if (b.providers.length !== a.providers.length && getStatus(a, nowMs) === 'live') return b.providers.length - a.providers.length;
    return a.startsAt - b.startsAt;
  });
}

export function buildLeagueRows(streams, nowMs) {
  const byLeague = new Map();
  streams.forEach((stream) => {
    if (stream.alwaysLive) return;
    const list = byLeague.get(stream.league) || [];
    list.push(stream);
    byLeague.set(stream.league, list);
  });
  return [...byLeague.entries()]
    .map(([league, list]) => ({
      league,
      items: sortForRow(list, nowMs),
      liveCount: list.filter((stream) => getStatus(stream, nowMs) === 'live').length,
      order: LEAGUE_ORDER.indexOf(league) === -1 ? 100 : LEAGUE_ORDER.indexOf(league),
    }))
    .sort((a, b) => (b.liveCount > 0) - (a.liveCount > 0) || a.order - b.order || b.items.length - a.items.length);
}

// ── Player ─────────────────────────────────────────────────────────────
