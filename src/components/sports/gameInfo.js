// What a game card, the player and the Sports page say about a game: its status,
// start time, score and teams, and how many games Multiview holds.
import { splitTeamsFromTitle, teamsMatch } from '../../utils/sportsProviders';

export const MULTIVIEW_MAX = 4;

// The ESPN teams in the order the game is named ("A vs B" → [A, B]).
export function teamsInNameOrder(stream, score) {
  const named = stream.teams || splitTeamsFromTitle(stream.name);
  const [first, second] = score.teams;
  if (named && second && teamsMatch(named.home, second.name)) return [second, first];
  return [first, second];
}

// Adds the ESPN score to a schedule entry, and its logos and team colors when
// the feeds had none (most NFL/NBA/MLB/Premier League listings have no logos;
// only PPV sends colors).
export function withScore(stream, score) {
  if (!score) return stream;
  const next = { ...stream, score };
  const [first, second] = teamsInNameOrder(stream, score);
  if (!(stream.logos?.home && stream.logos?.away) && first?.logo && second?.logo) {
    next.logos = { home: first.logo, away: second.logo };
  }
  if (!(stream.colors?.length >= 2) && first?.color && second?.color) next.colors = [first.color, second.color];
  if (!stream.conference && score.conference) next.conference = score.conference;
  return next;
}

// Logos and colors from the league's team list (fetchTeamLooks) for games
// still missing them after their score, so every card is drawn the same way.
export function withTeamLooks(stream, looks) {
  if (!looks) return stream;
  const next = { ...stream };
  if (!(stream.logos?.home && stream.logos?.away) && looks.logos) next.logos = looks.logos;
  if (!(stream.colors?.length >= 2) && looks.colors) next.colors = looks.colors;
  if (!stream.conference && looks.conference) next.conference = looks.conference;
  return next;
}

export function fmtTime(unix) {
  if (!unix) return '';
  return new Date(unix * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function fmtDay(unix) {
  if (!unix) return '';
  const date = new Date(unix * 1000);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

export function timeUntil(unix) {
  const diff = unix * 1000 - Date.now();
  if (diff <= 0) return null;
  const hours = Math.floor(diff / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  if (hours >= 24) return null;
  return hours > 0 ? `in ${hours}h ${minutes}m` : `in ${minutes}m`;
}

export function getStatus(stream, nowMs) {
  const nowSec = Math.floor(nowMs / 1000);
  if (stream.alwaysLive) return 'live';
  // ESPN knows when a game actually started and ended; the feeds only
  // estimate a window from the start time.
  if (stream.score?.state === 'post') return 'final';
  if (stream.score?.state === 'in') return 'live';
  if (stream.startsAt <= nowSec && stream.endsAt >= nowSec) return 'live';
  if (stream.startsAt > nowSec) return 'upcoming';
  return 'replay';
}

export function statusLabel(stream, nowMs) {
  const status = getStatus(stream, nowMs);
  if (status === 'live') return stream.alwaysLive ? '24/7' : 'LIVE';
  if (status === 'replay') return 'REPLAY';
  if (status === 'final') return 'FINAL';
  return `${fmtDay(stream.startsAt)} · ${fmtTime(stream.startsAt)}`;
}

export function scoreWords(stream, hideScores) {
  const score = stream.score;
  if (!score || score.state === 'pre' || hideScores) return '';
  return teamsInNameOrder(stream, score).map((team) => `${team.short || team.name} ${team.score}`).join(', ');
}
