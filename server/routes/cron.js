const express = require('express');
const webpush = require('web-push');

const router = express.Router();

// Daily new-episode alerts (Vercel cron → GET /api/cron/new-episodes, see
// vercel.json). For every profile with a push subscription: look at the TV
// shows in its list / Continue Watching, ask TMDB for each show's latest
// aired episode, and notify once per new episode (push_notified dedupes).
// Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, VAPID_PUBLIC_KEY +
// VAPID_PRIVATE_KEY (+ VAPID_SUBJECT), TMDB_API_KEY, and CRON_SECRET.

const NEW_WITHIN_DAYS = 2;

function getAdminClient() {
  const url = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return require('@supabase/supabase-js').createClient(url, key, { auth: { persistSession: false } });
}

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.authorization === `Bearer ${secret}`;
}

async function latestEpisode(tmdbId) {
  const key = process.env.TMDB_API_KEY || process.env.REACT_APP_TMDB_API_KEY;
  if (!key) return null;
  const res = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${key}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const data = await res.json();
  return { name: data.name, last: data.last_episode_to_air };
}

function setupPush() {
  const db = getAdminClient();
  if (!db || !process.env.VAPID_PRIVATE_KEY || !process.env.VAPID_PUBLIC_KEY) return null;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@binge.app', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  return db;
}

// Push one payload to each subscription; prunes expired ones.
async function pushTo(db, subs, payload) {
  let sent = 0;
  let removed = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 86400 });
      sent += 1;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await db.from('push_subscriptions').delete().eq('id', sub.id);
        removed += 1;
      }
    }
  }
  return { sent, removed };
}

// "Remind me tonight" reminders that are due. Meant to run every ~15 min
// (Vercel Hobby crons are daily only, so schedule it from Supabase
// pg_cron — see supabase/manual/schedule_reminders.sql); the daily
// new-episodes run also sweeps it as a fallback.
async function sendDueReminders(db) {
  const { data: due } = await db.from('watch_reminders')
    .select('id, user_id, profile_id, title, url')
    .is('sent_at', null).is('dismissed_at', null)
    .lte('remind_at', new Date().toISOString())
    .limit(500);
  let sent = 0;
  for (const reminder of due || []) {
    let query = db.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', reminder.user_id);
    if (reminder.profile_id) query = query.eq('profile_id', reminder.profile_id);
    const { data: subs } = await query;
    const result = await pushTo(db, subs || [], JSON.stringify({
      title: `Time to watch ${reminder.title}`,
      body: 'You asked binge. to remind you. Tap to start watching.',
      url: `${reminder.url}?play=1&reminder=${reminder.id}`,
      tag: `reminder-${reminder.id}`,
    }));
    sent += result.sent;
    await db.from('watch_reminders').update({ sent_at: new Date().toISOString() }).eq('id', reminder.id);
  }
  return { due: (due || []).length, sent };
}

// ── Followed-team game alerts ─────────────────────────────────────────
// Starting soon (≤30 min), close late, overtime, and no-hitters, for teams
// people follow (followed_teams.alerts). ESPN scoreboards, one per league.

const REGULATION = { football: 4, basketball: 4, hockey: 3, baseball: 9, soccer: 2 };

function clockSeconds(display) {
  const match = String(display || '').match(/(\d+):(\d+)/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function soccerMinute(display) {
  const match = String(display || '').match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

// Pure: which alerts does this ESPN event warrant right now?
function gameAlerts(path, event, now = Date.now()) {
  const sport = path.split('/')[0];
  const college = path.includes('college');
  const status = event.status || {};
  const state = status.type?.state;
  const period = Number(status.period) || 0;
  const clock = clockSeconds(status.displayClock);
  const competitors = event.competitions?.[0]?.competitors || [];
  if (competitors.length !== 2) return [];
  const [a, b] = competitors;
  const diff = Math.abs((Number(a.score) || 0) - (Number(b.score) || 0));
  const alerts = [];

  if (state === 'pre') {
    const minutes = (new Date(event.date).getTime() - now) / 60000;
    if (minutes > 0 && minutes <= 30) alerts.push({ kind: 'starting', minutes: Math.round(minutes) });
    return alerts;
  }
  if (state !== 'in') return alerts;

  const regulation = sport === 'basketball' && college ? 2 : REGULATION[sport];
  if (regulation && period > regulation) alerts.push({ kind: 'overtime' });

  let close = false;
  if (sport === 'football') close = period === 4 && diff <= 3;
  else if (sport === 'basketball') close = period === (college ? 2 : 4) && clock != null && clock <= 300 && diff <= 5;
  else if (sport === 'hockey') close = period === 3 && clock != null && clock <= 300 && diff <= 1;
  else if (sport === 'baseball') close = period >= 8 && diff <= 1;
  else if (sport === 'soccer') close = soccerMinute(status.displayClock) >= 75 && diff <= 1;
  if (close) alerts.push({ kind: 'close' });

  if (sport === 'baseball' && period >= 7) {
    const hitless = competitors.find((team) => Number(team.hits) === 0);
    if (hitless) alerts.push({ kind: 'no_hitter', hitless });
  }
  return alerts;
}

function alertMessage(alert, event) {
  const competitors = event.competitions[0].competitors;
  const away = competitors.find((c) => c.homeAway === 'away') || competitors[0];
  const home = competitors.find((c) => c.homeAway === 'home') || competitors[1];
  const score = `${away.team.shortDisplayName || away.team.displayName} ${away.score}–${home.score} ${home.team.shortDisplayName || home.team.displayName}`;
  const detail = event.status?.type?.shortDetail || '';
  switch (alert.kind) {
    case 'starting':
      return { title: `Starting soon: ${event.shortName || event.name}`, body: `Starts in ${alert.minutes} min. Tap to watch.` };
    case 'overtime':
      return { title: `Overtime! ${score}`, body: `${detail}. Tap to watch.` };
    case 'close':
      return { title: `Close game: ${score}`, body: `${detail}. Tap to watch.` };
    case 'no_hitter': {
      const pitching = competitors.find((c) => c !== alert.hitless);
      return { title: `No-hitter watch: ${pitching.team.displayName}`, body: `${alert.hitless.team.displayName} still hitless — ${detail}. Tap to watch.` };
    }
    default:
      return null;
  }
}

async function sendGameAlerts(db) {
  const { data: follows } = await db.from('followed_teams').select('user_id, profile_id, league_path, team_id').eq('alerts', true);
  if (!follows?.length) return { leagues: 0, sent: 0 };
  const byLeague = new Map();
  follows.forEach((row) => byLeague.set(row.league_path, [...(byLeague.get(row.league_path) || []), row]));
  let sent = 0;

  for (const [path, rows] of byLeague) {
    if (!/^[a-z-]+\/[a-z0-9.-]+$/.test(path)) continue;
    let board = null;
    try {
      const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; binge-alerts/1.0)' },
        signal: AbortSignal.timeout(8000),
      });
      board = res.ok ? await res.json() : null;
    } catch { board = null; }
    for (const event of board?.events || []) {
      const teamIds = new Set((event.competitions?.[0]?.competitors || []).map((c) => String(c.team?.id)));
      const followers = rows.filter((row) => teamIds.has(String(row.team_id)));
      if (!followers.length) continue;
      const alerts = gameAlerts(path, event);
      for (const alert of alerts) {
        const message = alertMessage(alert, event);
        if (!message) continue;
        const notified = new Set();
        for (const follower of followers) {
          const key = `${follower.user_id}|${follower.profile_id || ''}`;
          if (notified.has(key)) continue;
          notified.add(key);
          // Once per user, game and kind.
          const { error } = await db.from('game_alerts_sent').insert({ user_id: follower.user_id, event_id: String(event.id), kind: alert.kind });
          if (error) continue;
          let query = db.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', follower.user_id);
          if (follower.profile_id) query = query.eq('profile_id', follower.profile_id);
          const { data: subs } = await query;
          const result = await pushTo(db, subs || [], JSON.stringify({ ...message, url: '/sports', tag: `game-${event.id}-${alert.kind}` }));
          sent += result.sent;
        }
      }
    }
  }
  return { leagues: byLeague.size, sent };
}

// ── Streaming-server uptime ───────────────────────────────────────────
// Loads each embed server's player page for a known film and records
// up / slow / down (plus the last 24h of viewer reports), and alerts admins
// (push + optional ALERT_WEBHOOK_URL for Discord/Slack) when a server goes
// down for two checks in a row or comes back. A 200 page doesn't prove a
// video plays, which is why viewer reports are shown alongside.
// Keep in sync with PROVIDERS in src/components/EmbedPlayer.js.
const PROBE_TMDB = 550; // Fight Club — on every server
const PROBES = [
  ['vidrift', 'VidRift', `https://embed.vidrift.net/embed/movie/${PROBE_TMDB}`],
  ['vidy', 'Vidy', `https://vidy.st/movie/${PROBE_TMDB}`],
  ['vidlink', 'VidLink', `https://vidlink.pro/movie/${PROBE_TMDB}`],
  ['cinesrc', 'CineSrc', `https://cinesrc.st/embed/movie/${PROBE_TMDB}`],
  ['vidsrc-ru', 'VidSrc', `https://vidsrc.ru/movie/${PROBE_TMDB}`],
  ['vidsrc-su', 'VidSrc SU', `https://vidsrc.su/embed/movie/${PROBE_TMDB}`],
  ['videasy', 'Videasy', `https://player.videasy.net/movie/${PROBE_TMDB}`],
  ['2embed', '2Embed', `https://www.2embed.stream/embed/movie/${PROBE_TMDB}`],
  ['vidsrc-embed-ru', 'VidSrc Classic', `https://vsembed.ru/embed/movie?tmdb=${PROBE_TMDB}`],
  ['vidsrc-rip', 'VidSrc RIP', `https://vidsrc.rip/embed/movie/${PROBE_TMDB}`],
];
const HEALTH_EVERY_MS = 15 * 60 * 1000;
const UNAVAILABLE = /media is unavailable|video not found|not available in your|404 not found|bad gateway|service unavailable/i;

async function probe(url) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' },
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
    });
    const body = (await res.text()).slice(0, 20000);
    const latency = Date.now() - started;
    // Bot protection (Cloudflare etc.) refuses server-side checks even when
    // the player works fine in a browser — that's "can't tell", not down.
    if ([401, 403, 429].includes(res.status)) return { status: 'unknown', http: res.status, latency, detail: 'Blocks automated checks — using viewer reports' };
    if (!res.ok) return { status: 'down', http: res.status, latency, detail: `HTTP ${res.status}` };
    if (UNAVAILABLE.test(body)) return { status: 'down', http: res.status, latency, detail: 'Page says the video is unavailable' };
    return { status: latency > 6000 ? 'slow' : 'up', http: res.status, latency, detail: latency > 6000 ? 'Slow to respond' : null };
  } catch (error) {
    return { status: 'down', http: null, latency: Date.now() - started, detail: error.name === 'TimeoutError' ? 'Timed out' : (error.cause?.code || error.message) };
  }
}

async function notifyAdmins(db, title, body) {
  const webhook = process.env.ALERT_WEBHOOK_URL;
  if (webhook) {
    // Discord reads `content`, Slack reads `text`.
    await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: `**${title}**\n${body}`, text: `*${title}*\n${body}` }) }).catch(() => {});
  }
  const { data: admins } = await db.from('profiles').select('id').eq('is_admin', true);
  const ids = (admins || []).map((row) => row.id);
  if (!ids.length) return;
  const { data: subs } = await db.from('push_subscriptions').select('id, endpoint, p256dh, auth').in('user_id', ids);
  await pushTo(db, subs || [], JSON.stringify({ title, body, url: '/admin', tag: `server-${title}` }));
}

async function checkServers(db, { force = false } = {}) {
  const { data: rows } = await db.from('server_status').select('*');
  const previous = new Map((rows || []).map((row) => [row.provider, row]));
  const lastRun = Math.max(0, ...(rows || []).map((row) => new Date(row.checked_at || 0).getTime()));
  if (!force && Date.now() - lastRun < HEALTH_EVERY_MS) return { skipped: true };

  const since = new Date(Date.now() - 86400000).toISOString();
  const { data: reports } = await db.from('stream_reports').select('provider, works').gte('updated_at', since).limit(5000);
  const counts = new Map();
  (reports || []).forEach((row) => {
    const entry = counts.get(row.provider) || { works: 0, broken: 0 };
    if (row.works) entry.works += 1; else entry.broken += 1;
    counts.set(row.provider, entry);
  });

  const now = new Date().toISOString();
  const results = await Promise.all(PROBES.map(async ([provider, label, url]) => ({ provider, label, ...(await probe(url)) })));
  const changes = [];
  for (const result of results) {
    const before = previous.get(result.provider);
    // Viewers' reports decide for servers we can't probe, and can flag a
    // server whose page loads but whose videos don't play.
    const viewer = counts.get(result.provider) || { works: 0, broken: 0 };
    if (result.status !== 'down' && viewer.broken >= 3 && viewer.broken >= viewer.works * 2) {
      result.status = 'down';
      result.detail = `${viewer.broken} viewers couldn’t play it in the last day`;
    }
    const failCount = result.status === 'down' ? (before?.fail_count || 0) + 1 : 0;
    const row = {
      provider: result.provider,
      label: result.label,
      status: result.status,
      http_status: result.http,
      latency_ms: result.latency,
      detail: result.detail,
      reports_broken_24h: counts.get(result.provider)?.broken || 0,
      reports_works_24h: counts.get(result.provider)?.works || 0,
      fail_count: failCount,
      alerted_down: before?.alerted_down || false,
      checked_at: now,
      changed_at: before?.status === result.status ? before?.changed_at || now : now,
    };
    // Two failed checks in a row (~30 min) before alerting — one blip isn't an outage.
    if (failCount >= 2 && !row.alerted_down) {
      row.alerted_down = true;
      changes.push(`🔴 ${result.label} is down (${result.detail || 'no response'})`);
    } else if (result.status !== 'down' && before?.alerted_down) {
      row.alerted_down = false;
      changes.push(`🟢 ${result.label} is back up`);
    }
    // eslint-disable-next-line no-await-in-loop
    await db.from('server_status').upsert(row);
  }
  if (changes.length) {
    await notifyAdmins(db, changes.length === 1 ? changes[0] : `${changes.length} streaming servers changed`, changes.join('\n'));
  }
  return { checked: results.length, down: results.filter((r) => r.status === 'down').map((r) => r.provider), alerts: changes.length };
}

router.get('/health', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' });
  const db = setupPush() || getAdminClient();
  if (!db) return res.status(503).json({ error: 'database not configured' });
  try {
    res.json(await checkServers(db, { force: true }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/sports', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' });
  const db = setupPush();
  if (!db) return res.status(503).json({ error: 'push not configured' });
  try {
    res.json(await sendGameAlerts(db));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/reminders', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' });
  const db = setupPush();
  if (!db) return res.status(503).json({ error: 'push not configured' });
  try {
    // The same frequent job also checks followed teams' games.
    const [reminders, games, servers] = await Promise.all([
      sendDueReminders(db),
      sendGameAlerts(db).catch((err) => ({ error: err.message })),
      checkServers(db).catch((err) => ({ error: err.message })), // throttled to every 15 min
    ]);
    res.json({ ...reminders, games, servers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/new-episodes', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' });
  const db = setupPush();
  if (!db) return res.status(503).json({ error: 'push not configured' });
  const reminders = await sendDueReminders(db).catch(() => null);

  const { data: subs, error } = await db.from('push_subscriptions').select('id, user_id, profile_id, endpoint, p256dh, auth');
  if (error) return res.status(500).json({ error: error.message });

  const cutoff = Date.now() - NEW_WITHIN_DAYS * 86400000;
  const showCache = new Map(); // tv_shows.id -> latest episode info
  let sent = 0;
  let removed = 0;

  // Group subscriptions by profile so each profile's list is read once.
  const byProfile = new Map();
  (subs || []).forEach((sub) => {
    const key = `${sub.user_id}|${sub.profile_id || ''}`;
    byProfile.set(key, [...(byProfile.get(key) || []), sub]);
  });

  for (const [profileKey, profileSubs] of byProfile) {
    const [userId, profileId] = profileKey.split('|');
    const scope = (query) => (profileId ? query.eq('profile_id', profileId) : query.is('profile_id', null));
    const [{ data: list }, { data: watching }] = await Promise.all([
      scope(db.from('watchlist').select('media_id, status').eq('user_id', userId).eq('media_type', 'tv_show')),
      scope(db.from('continue_watching').select('media_id').eq('user_id', userId).eq('media_type', 'tv_show')),
    ]);
    const showIds = [...new Set([
      ...(list || []).filter((row) => row.status !== 'watched').map((row) => Number(row.media_id)),
      ...(watching || []).map((row) => Number(row.media_id)),
    ])].slice(0, 60);
    if (!showIds.length) continue;

    const { data: shows } = await db.from('tv_shows').select('id, title, source_key').in('id', showIds);
    for (const show of shows || []) {
      const tmdbId = String(show.source_key || '').match(/^tmdb:tv:(\d+)$/)?.[1];
      if (!tmdbId) continue;
      if (!showCache.has(show.id)) showCache.set(show.id, await latestEpisode(tmdbId).catch(() => null));
      const info = showCache.get(show.id);
      const last = info?.last;
      if (!last?.air_date || new Date(`${last.air_date}T23:59:59Z`).getTime() < cutoff) continue;

      const episodeKey = `S${last.season_number}E${last.episode_number}`;
      const { data: already } = await db.from('push_notified').select('episode_key')
        .eq('user_id', userId).eq('media_id', show.id).eq('episode_key', episodeKey).maybeSingle();
      if (already) continue;

      const payload = JSON.stringify({
        title: `New episode: ${show.title}`,
        body: `S${last.season_number} · E${last.episode_number}${last.name ? ` — ${last.name}` : ''} is out now.`,
        url: `/tv-show/${show.id}?play=1&season=${last.season_number}&episode=${last.episode_number}`,
        tag: `new-episode-${show.id}`,
      });
      const result = await pushTo(db, profileSubs, payload);
      sent += result.sent;
      removed += result.removed;
      if (result.sent) {
        await db.from('push_notified').insert({ user_id: userId, profile_id: profileId || null, media_id: show.id, episode_key: episodeKey });
      }
    }
  }

  res.json({ profiles: byProfile.size, sent, removedSubscriptions: removed, reminders });
});

module.exports = router;
module.exports.gameAlerts = gameAlerts;
module.exports.checkServers = checkServers;
module.exports.pushTo = pushTo;
module.exports.setupPush = setupPush;
