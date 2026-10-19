const crypto = require('crypto');
const express = require('express');
const { serviceClient, userFromRequest } = require('../middleware/supabaseAdmin');
const router = express.Router();

// Server-side proxy + cache for the three sports providers. Returns the
// normalized but UNMERGED list ({ raw }); src/utils/sportsProviders.js's
// mergeNormalized() turns it into one entry per game.

const CACHE_TTL = 60 * 1000;
let cache = null;
let cacheTime = 0;

const RESOLVE_CACHE_TTL = 30 * 1000;
const resolveCache = new Map();

const DURATION_SEC = {
  Basketball: 3 * 3600,
  Soccer: 2.25 * 3600,
  'American Football': 3.5 * 3600,
  Baseball: 3.5 * 3600,
  Hockey: 3 * 3600,
  'Combat Sports': 5 * 3600,
  Tennis: 3 * 3600,
  Golf: 5 * 3600,
  Racing: 3 * 3600,
  Rugby: 2 * 3600,
  Cricket: 8 * 3600,
  'Australian Football': 2.5 * 3600,
  Billiards: 3 * 3600,
  Darts: 3 * 3600,
};
const DEFAULT_DURATION_SEC = 3 * 3600;

const STREAMED_CATEGORY_MAP = {
  basketball: 'Basketball',
  football: 'Soccer',
  'american-football': 'American Football',
  hockey: 'Hockey',
  baseball: 'Baseball',
  'motor-sports': 'Racing',
  fight: 'Combat Sports',
  tennis: 'Tennis',
  rugby: 'Rugby',
  golf: 'Golf',
  billiards: 'Billiards',
  afl: 'Australian Football',
  darts: 'Darts',
  cricket: 'Cricket',
  other: 'Other',
};

const STREAMFREE_CATEGORY_MAP = {
  soccer: 'Soccer',
  basketball: 'Basketball',
  hockey: 'Hockey',
  combat: 'Combat Sports',
  baseball: 'Baseball',
  football: 'American Football',
  racing: 'Racing',
  tennis: 'Tennis',
  cricket: 'Cricket',
};

function isTruthy(val) {
  return val === 1 || val === true || val === '1';
}

// Normalizers mirror src/utils/sportsProviders.js's fetch*Normalized
// (Node can't import from src/). Only fetching + normalizing happens here;
// the fuzzy one-entry-per-game merge runs client-side on this raw list, so
// that matching logic exists in exactly one place.
async function fetchPpvNormalized() {
  const res = await fetch('https://api.ppv.st/api/streams', {
    headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; sports-aggregator/1.0)' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`ppv.st ${res.status}`);
  const data = await res.json();
  if (!data.success) throw new Error('ppv.st error');

  const now = Math.floor(Date.now() / 1000);
  const out = [];
  for (const cat of data.streams || []) {
    const catAlwaysLive = isTruthy(cat.always_live);
    for (const s of cat.streams || []) {
      const alwaysLive = catAlwaysLive || isTruthy(s.always_live);
      const ended = !alwaysLive && s.ends_at < now;
      if (ended && !isTruthy(s.allowpaststreams)) continue;
      if (!s.iframe) continue;
      const rawCategory = s.category_name || cat.category || 'Other';
      // PPV.st's "24/7 Streams" bucket is non-sports (cartoon reruns etc.).
      if (rawCategory === '24/7 Streams') continue;
      // The main embed plus any mirrors ("substreams", each with its own tag).
      const embeds = [{ iframe: s.iframe, tag: s.source_tag }, ...(Array.isArray(s.substreams) ? s.substreams : [])
        .filter((sub) => sub && sub.iframe && sub.iframe !== s.iframe)
        .map((sub) => ({ iframe: sub.iframe, tag: sub.source_tag }))];
      for (const embed of embeds) {
        out.push({
          name: s.name,
          category: rawCategory,
          poster: s.poster || null,
          tag: s.tag || null,
          colors: Array.isArray(s.colors) ? s.colors : null,
          startsAt: s.starts_at,
          endsAt: s.ends_at,
          alwaysLive,
          replay: ended && isTruthy(s.allowpaststreams),
          provider: { id: 'ppv', embedUrl: embed.iframe, label: embed.tag ? `PPV · ${embed.tag}` : 'PPV' },
        });
      }
    }
  }
  return out;
}

async function fetchStreamedNormalized() {
  const res = await fetch('https://streamed.pk/api/matches/all', {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`streamed.pk ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('streamed.pk error');

  const now = Math.floor(Date.now() / 1000);
  const out = [];
  for (const m of data) {
    if (!Array.isArray(m.sources) || m.sources.length === 0) continue;
    const category = STREAMED_CATEGORY_MAP[m.category] || 'Other';
    const startsAt = Math.floor((m.date || 0) / 1000);
    const endsAt = startsAt + (DURATION_SEC[category] || DEFAULT_DURATION_SEC);
    if (startsAt && now > endsAt) continue;
    const homeTeam = m.teams && m.teams.home;
    const awayTeam = m.teams && m.teams.away;
    const home = homeTeam ? homeTeam.name : null;
    const away = awayTeam ? awayTeam.name : null;
    const badge = (team) => (team && team.badge ? `https://streamed.pk/api/images/badge/${team.badge}.webp` : null);
    for (const src of m.sources) {
      out.push({
        name: m.title,
        category,
        poster: m.poster ? `https://streamed.pk${m.poster}` : null,
        tag: null,
        teams: home && away ? { home, away } : null,
        logos: home && away ? { home: badge(homeTeam), away: badge(awayTeam) } : null,
        startsAt,
        endsAt,
        alwaysLive: !startsAt,
        replay: false,
        provider: { id: 'streamed', source: src.source, matchId: src.id, label: `Streamed · ${src.source}` },
      });
    }
  }
  return out;
}

// "…/football/redzone1080p" → "StreamFree 1080p"; numbered when unclear.
function streamfreeLabel(url, index, count) {
  const quality = /(2160|1080|720|480)p/.exec(url);
  if (quality) return `StreamFree ${quality[1] === '2160' ? '4K' : `${quality[1]}p`}`;
  return count > 1 ? `StreamFree ${index + 1}` : 'StreamFree';
}

async function fetchStreamfreeNormalized() {
  const res = await fetch('https://streamfree.top/api/v1/streams', {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`streamfree ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data.streams)) throw new Error('streamfree error');

  const now = Math.floor(Date.now() / 1000);
  const out = [];
  for (const s of data.streams) {
    const category = STREAMFREE_CATEGORY_MAP[s.category] || 'Other';
    const startsAt = s.match_timestamp || 0;
    const duration = DURATION_SEC[category] || DEFAULT_DURATION_SEC;
    const endsAt = startsAt ? startsAt + duration : now + duration;
    // Embeds appear in "sources" near game time (older API: embed_url).
    const embeds = [...new Set([...(Array.isArray(s.sources) ? s.sources : []), s.embed_url].filter((url) => typeof url === 'string' && url.startsWith('http')))];
    if (embeds.length === 0) continue;
    // Channels (RedZone, Sky Sports F1, Willow) keep a timestamp from weeks
    // ago; anything with embeds that "started" over 2 days back is one.
    const channel = Boolean(startsAt) && now - startsAt > 2 * 86400;
    if (startsAt && now > endsAt && !channel) continue;
    const home = s.team1 ? s.team1.name : null;
    const away = s.team2 ? s.team2.name : null;
    for (const [index, embedUrl] of embeds.entries()) {
      out.push({
        name: s.name,
        category,
        poster: s.thumbnail_url || null,
        tag: s.league || null,
        teams: home && away ? { home, away } : null,
        logos: home && away ? { home: (s.team1 && s.team1.logo) || null, away: (s.team2 && s.team2.logo) || null } : null,
        startsAt: channel ? 0 : startsAt,
        endsAt: channel ? now + duration : endsAt,
        alwaysLive: !startsAt || channel,
        replay: false,
        provider: { id: 'streamfree', embedUrl, label: streamfreeLabel(embedUrl, index, embeds.length) },
      });
    }
  }
  return out;
}

async function fetchRawStreams() {
  if (cache && Date.now() - cacheTime < CACHE_TTL) return cache;

  const [ppv, streamed, streamfree] = await Promise.allSettled([
    fetchPpvNormalized(),
    fetchStreamedNormalized(),
    fetchStreamfreeNormalized(),
  ]);

  const lists = [];
  if (ppv.status === 'fulfilled') lists.push(...ppv.value);
  else console.error('[sports] ppv.st', ppv.reason && ppv.reason.message);
  if (streamed.status === 'fulfilled') lists.push(...streamed.value);
  else console.error('[sports] streamed.pk', streamed.reason && streamed.reason.message);
  if (streamfree.status === 'fulfilled') lists.push(...streamfree.value);
  else console.error('[sports] streamfree', streamfree.reason && streamfree.reason.message);

  if (lists.length === 0) {
    if (cache) return cache;
    throw new Error('All sports providers unavailable');
  }

  const result = { raw: lists };
  cache = result;
  cacheTime = Date.now();
  return result;
}

router.get('/streams', async (req, res) => {
  try {
    const result = await fetchRawStreams();
    res.json(result);
  } catch (err) {
    console.error('[sports]', err.message);
    res.status(502).json({ error: 'Sports streams unavailable', details: err.message });
  }
});

router.get('/resolve/streamed/:source/:matchId', async (req, res) => {
  const { source, matchId } = req.params;
  // ?all=1: every stream of this source (numbered feeds, HD and SD,
  // commentary languages), not just the best one.
  const all = req.query.all === '1';
  const cacheKey = `${source}/${matchId}`;
  const cached = resolveCache.get(cacheKey);
  if (cached && Date.now() - cached.time < RESOLVE_CACHE_TTL) {
    return res.json(all ? { embedUrl: cached.embedUrl, streams: cached.streams } : { embedUrl: cached.embedUrl });
  }

  try {
    const upstream = await fetch(
      `https://streamed.pk/api/stream/${encodeURIComponent(source)}/${encodeURIComponent(matchId)}`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) },
    );
    if (!upstream.ok) throw new Error(`streamed.pk ${upstream.status}`);
    const list = await upstream.json();
    if (!Array.isArray(list) || list.length === 0) throw new Error('no streams for source');
    const best = list.find((s) => s.hd) || list[0];
    const embedUrl = best.embedUrl || null;
    const streams = list
      .filter((s) => typeof s.embedUrl === 'string')
      .map((s) => ({ embedUrl: s.embedUrl, streamNo: s.streamNo, hd: Boolean(s.hd), language: s.language || '' }));
    resolveCache.set(cacheKey, { embedUrl, streams, time: Date.now() });
    res.json(all ? { embedUrl, streams } : { embedUrl });
  } catch (err) {
    console.error('[sports] resolve streamed', err.message);
    res.status(502).json({ error: 'Could not resolve stream', details: err.message });
  }
});

// ESPN scores fallback for the live score panel (utils/liveScores.js calls
// ESPN directly first). Only scoreboard/summary paths are allowed through.
const ESPN_PATH = /^[a-z-]+\/[a-z0-9.-]+\/(scoreboard|summary|teams)$/;
const espnCache = new Map(); // url -> { at, body }

router.get('/espn', async (req, res) => {
  const path = String(req.query.path || '');
  if (!ESPN_PATH.test(path)) return res.status(400).json({ error: 'bad path' });
  const params = new URLSearchParams();
  ['dates', 'event', 'groups', 'limit'].forEach((key) => {
    if (req.query[key] && /^[0-9]{1,12}$/.test(String(req.query[key]))) params.set(key, String(req.query[key]));
  });
  const url = `https://site.api.espn.com/apis/site/v2/sports/${path}${params.toString() ? `?${params}` : ''}`;
  const hit = espnCache.get(url);
  if (hit && Date.now() - hit.at < 15000) return res.type('json').send(hit.body);
  try {
    const upstream = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; binge-scores/1.0)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!upstream.ok) return res.status(upstream.status).json({ error: `espn ${upstream.status}` });
    const body = await upstream.text();
    espnCache.set(url, { at: Date.now(), body });
    if (espnCache.size > 200) espnCache.delete(espnCache.keys().next().value);
    res.set('Cache-Control', 'public, max-age=15').type('json').send(body);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ESPN Fantasy roster for the live score panel (utils/fantasy.js). ESPN has no
// official API; this is the one its own site uses. Public leagues need only
// the league id. Private leagues need the viewer's espn_s2 + SWID cookies,
// which the browser can't attach to a cross-site request. Signed-in viewers
// save them once (PUT /fantasy/credentials): they're encrypted here and kept
// in espn_credentials, which only the service role can read, and never sent
// back to the browser. Signed-out viewers send them as headers (never the
// URL, so they stay out of logs).
const FANTASY_GAMES = new Set(['ffl', 'flb', 'fba', 'fhl']);
const FANTASY_BASE = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games';
const fantasyGameCache = new Map(); // game -> { at, season, period, proTeams }
const fantasyCache = new Map(); // url + swid -> { at, data }
const S2_PATTERN = /^[A-Za-z0-9%+/=_.-]{20,2000}$/;
const SWID_PATTERN = /^\{?[0-9A-Fa-f-]{36}\}?$/;

// AES-256-GCM key: FANTASY_CREDENTIALS_KEY when set, else derived from the
// service-role key (rotating that key just means people paste cookies again).
function credentialsKey() {
  const secret = process.env.FANTASY_CREDENTIALS_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return null;
  return Buffer.from(crypto.hkdfSync('sha256', secret, 'binge.', 'espn-credentials', 32));
}

function sealCredentials(value) {
  const key = credentialsKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64url')).join('.');
}

function openCredentials(sealed) {
  try {
    const [iv, tag, data] = String(sealed).split('.').map((part) => Buffer.from(part, 'base64url'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', credentialsKey(), iv);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'));
  } catch {
    return null; // key changed or row tampered with
  }
}

function braceSwid(swid) {
  return swid ? `{${String(swid).replace(/[{}]/g, '').toUpperCase()}}` : '';
}

// The signed-in user and the profile they're acting as (which must be one of
// theirs). { error, status } when that fails.
async function fantasyViewer(req, profileId) {
  const db = serviceClient();
  if (!db || !credentialsKey()) return { status: 503, error: 'Saving ESPN logins isn\u2019t set up on this server.' };
  const user = await userFromRequest(req);
  if (!user) return { status: 401, error: 'Sign in to save your ESPN login.' };
  const profile = profileId && /^[0-9a-f-]{36}$/i.test(profileId) ? profileId : null;
  if (profile) {
    const { data } = await db.from('account_profiles').select('id').eq('id', profile).eq('account_id', user.id).maybeSingle();
    if (!data) return { status: 403, error: 'That profile isn\u2019t on your account.' };
  }
  return { db, user, profileId: profile };
}

function credentialsRow(db, userId, profileId) {
  const query = db.from('espn_credentials').select('id, secret, swid_hint, updated_at').eq('user_id', userId);
  return (profileId ? query.eq('profile_id', profileId) : query.is('profile_id', null)).maybeSingle();
}

// Whether this profile has a saved ESPN login (never the cookies themselves).
router.get('/fantasy/credentials', async (req, res) => {
  const viewer = await fantasyViewer(req, String(req.query.profileId || ''));
  if (viewer.error) return res.status(viewer.status).json({ error: viewer.error });
  const { data } = await credentialsRow(viewer.db, viewer.user.id, viewer.profileId);
  res.set('Cache-Control', 'private, no-store').json({ saved: Boolean(data), swidHint: data?.swid_hint || null, updatedAt: data?.updated_at || null });
});

router.put('/fantasy/credentials', async (req, res) => {
  const { profileId, s2, swid } = req.body || {};
  const viewer = await fantasyViewer(req, String(profileId || ''));
  if (viewer.error) return res.status(viewer.status).json({ error: viewer.error });
  const cleanS2 = String(s2 || '').trim();
  const cleanSwid = braceSwid(String(swid || '').trim());
  if (!S2_PATTERN.test(cleanS2) || !SWID_PATTERN.test(cleanSwid)) {
    return res.status(400).json({ error: 'Those cookies don\u2019t look right. Copy espn_s2 and SWID again.' });
  }
  const row = {
    user_id: viewer.user.id,
    profile_id: viewer.profileId,
    secret: sealCredentials({ s2: cleanS2, swid: cleanSwid }),
    swid_hint: cleanSwid.replace(/[{}]/g, '').slice(-4),
    updated_at: new Date().toISOString(),
  };
  const { data: existing } = await credentialsRow(viewer.db, viewer.user.id, viewer.profileId);
  const { error } = existing
    ? await viewer.db.from('espn_credentials').update(row).eq('id', existing.id)
    : await viewer.db.from('espn_credentials').insert(row);
  if (error) return res.status(500).json({ error: 'Couldn\u2019t save your ESPN login.' });
  res.json({ saved: true, swidHint: row.swid_hint });
});

router.delete('/fantasy/credentials', async (req, res) => {
  const viewer = await fantasyViewer(req, String(req.query.profileId || ''));
  if (viewer.error) return res.status(viewer.status).json({ error: viewer.error });
  const query = viewer.db.from('espn_credentials').delete().eq('user_id', viewer.user.id);
  await (viewer.profileId ? query.eq('profile_id', viewer.profileId) : query.is('profile_id', null));
  res.json({ saved: false });
});

// Cookies for a roster request: headers if sent, else this profile's saved login.
async function requestCredentials(req) {
  const s2 = String(req.get('x-espn-s2') || '').trim();
  const swid = String(req.get('x-espn-swid') || '').trim();
  if (s2 || swid) {
    if (!S2_PATTERN.test(s2) || !SWID_PATTERN.test(swid)) return { error: 'Those cookies don\u2019t look right. Copy espn_s2 and SWID again.' };
    return { s2, swid: braceSwid(swid) };
  }
  if (!req.get('authorization')) return {};
  const viewer = await fantasyViewer(req, String(req.query.profileId || ''));
  if (viewer.error) return {};
  const { data } = await credentialsRow(viewer.db, viewer.user.id, viewer.profileId);
  const saved = data && openCredentials(data.secret);
  return saved ? { s2: saved.s2, swid: saved.swid, saved: true } : {};
}

async function fantasyFetch(url, cookie) {
  const upstream = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; binge-fantasy/1.0)',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    signal: AbortSignal.timeout(10000),
  });
  const body = await upstream.json().catch(() => null);
  return { status: upstream.status, ok: upstream.ok, body };
}

async function fantasyGameInfo(game) {
  const hit = fantasyGameCache.get(game);
  if (hit && Date.now() - hit.at < 30 * 60 * 1000) return hit;
  const meta = await fantasyFetch(`${FANTASY_BASE}/${game}`);
  if (!meta.ok) throw new Error(`espn fantasy ${meta.status}`);
  const season = meta.body?.currentSeasonId;
  const teams = await fantasyFetch(`${FANTASY_BASE}/${game}/seasons/${season}?view=proTeamSchedules_wl`);
  const info = {
    at: Date.now(),
    season,
    period: meta.body?.currentSeason?.currentScoringPeriod?.id || null,
    proTeams: Object.fromEntries((teams.body?.settings?.proTeams || []).map((t) => [t.id, t.abbrev])),
  };
  fantasyGameCache.set(game, info);
  return info;
}

// statSourceId 0 = actual points, 1 = ESPN's projection.
function statTotal(player, period, source) {
  const line = (player?.stats || []).find((s) => s.scoringPeriodId === period && s.statSourceId === source);
  return typeof line?.appliedTotal === 'number' ? Math.round(line.appliedTotal * 100) / 100 : null;
}

router.get('/fantasy/:game/:leagueId', async (req, res) => {
  const { game, leagueId } = req.params;
  if (!FANTASY_GAMES.has(game) || !/^[0-9]{1,12}$/.test(leagueId)) return res.status(400).json({ error: 'bad league' });
  const credentials = await requestCredentials(req);
  if (credentials.error) return res.status(400).json({ error: credentials.error });
  const swidBraced = credentials.swid || '';
  const cookie = credentials.s2 && swidBraced ? `espn_s2=${credentials.s2}; SWID=${swidBraced}` : '';

  try {
    const info = await fantasyGameInfo(game);
    const params = new URLSearchParams();
    // mMatchupScore: this week's head-to-head scores for the fantasy board.
    ['mTeam', 'mRoster', 'mSettings', 'mMatchupScore'].forEach((view) => params.append('view', view));
    if (info.period) params.set('scoringPeriodId', String(info.period));
    const url = `${FANTASY_BASE}/${game}/seasons/${info.season}/segments/0/leagues/${leagueId}?${params}`;
    const cacheKey = `${url}|${swidBraced}|${(credentials.s2 || '').slice(-12)}`;
    let hit = fantasyCache.get(cacheKey);
    if (!hit || Date.now() - hit.at > 20000) {
      const upstream = await fantasyFetch(url, cookie);
      if (upstream.status === 401 || upstream.status === 403) {
        return res.status(401).json({
          error: cookie ? 'ESPN refused your saved login. The cookies may have expired: paste them again.' : 'This league is private. Add your ESPN cookies to see it.',
          needsCredentials: true,
        });
      }
      if (upstream.status === 404) return res.status(404).json({ error: 'No league with that id this season.' });
      if (!upstream.ok) return res.status(502).json({ error: `ESPN Fantasy answered ${upstream.status}` });
      hit = { at: Date.now(), data: upstream.body };
      fantasyCache.set(cacheKey, hit);
      if (fantasyCache.size > 100) fantasyCache.delete(fantasyCache.keys().next().value);
    }

    const data = hit.data || {};
    const period = data.scoringPeriodId || info.period;
    const members = new Map((data.members || []).map((m) => [m.id, m.displayName || [m.firstName, m.lastName].filter(Boolean).join(' ')]));
    // This week's matchup per team: its score and the opponent's (live points while games are on).
    const week = data.status?.currentMatchupPeriod || null;
    const side = (s) => (s ? { teamId: s.teamId, points: Math.round((s.totalPointsLive ?? s.totalPoints ?? 0) * 100) / 100, projected: s.totalProjectedPointsLive ?? null } : null);
    const matchups = new Map();
    (data.schedule || []).filter((m) => m.matchupPeriodId === week).forEach((m) => {
      const home = side(m.home); const away = side(m.away);
      if (home) matchups.set(home.teamId, { points: home.points, projected: home.projected, opponentId: away?.teamId ?? null, opponentPoints: away?.points ?? null });
      if (away) matchups.set(away.teamId, { points: away.points, projected: away.projected, opponentId: home?.teamId ?? null, opponentPoints: home?.points ?? null });
    });
    const teams = (data.teams || []).map((team) => ({
      id: team.id,
      name: team.name || [team.location, team.nickname].filter(Boolean).join(' ') || team.abbrev || `Team ${team.id}`,
      abbrev: team.abbrev || '',
      owner: members.get((team.owners || [])[0]) || '',
      logo: /^https?:\/\//.test(team.logo || '') ? team.logo : null,
      record: team.record?.overall ? { wins: team.record.overall.wins || 0, losses: team.record.overall.losses || 0, ties: team.record.overall.ties || 0 } : null,
      seed: team.playoffSeed || team.rankCalculatedFinal || null,
      matchup: matchups.get(team.id) || null,
      mine: Boolean(swidBraced && (team.owners || []).some((owner) => String(owner).toUpperCase() === swidBraced)),
      roster: (team.roster?.entries || []).map((entry) => {
        const player = entry.playerPoolEntry?.player || {};
        const hurt = player.injuryStatus && player.injuryStatus !== 'ACTIVE' && player.injuryStatus !== 'NORMAL';
        return {
          id: entry.playerId,
          name: player.fullName || '',
          proTeamId: player.proTeamId ?? null,
          proTeam: info.proTeams[player.proTeamId] || '',
          positionId: player.defaultPositionId ?? null,
          slotId: entry.lineupSlotId ?? null,
          injury: hurt ? player.injuryStatus : null,
          points: statTotal(player, period, 0),
          projected: statTotal(player, period, 1),
        };
      }),
    }));
    res.set('Cache-Control', 'private, no-store').json({ game, season: info.season, period, week, leagueName: data.settings?.name || '', teams });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
