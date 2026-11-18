const express = require('express');
const webpush = require('web-push');
const mailer = require('../mailer');
const { digestEmail, reminderEmail } = require('../alertEmails');

const router = express.Router();

// Daily new-episode alerts (Vercel cron → GET /api/cron/new-episodes, see
// vercel.json). For every profile, notifications on or not: look at the TV
// shows in its list / Continue Watching, ask TMDB for each show's latest
// aired episode, and alert once per new episode (sendNewEpisodeAlerts): in
// the profile's notification inbox, and by push on its devices where it has
// any. Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, TMDB_API_KEY and
// CRON_SECRET; the push part also VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY
// (+ VAPID_SUBJECT), and email alerts SMTP_* (mailer.js).

const NEW_WITHIN_DAYS = 2;

function getAdminClient() {
  const url = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
  const key = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) return null;
  return require('../data-access/client').createHybridClient(url, key, { auth: { persistSession: false } });
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

// Push a payload to each subscription (the same text, or payload(sub) for
// one per device); prunes expired ones.
async function pushTo(db, subs, payload) {
  let sent = 0;
  let removed = 0;
  for (const sub of subs) {
    try {
      const body = typeof payload === 'function' ? payload(sub) : payload;
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, body, { TTL: 86400 });
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

// ── Notification inbox ────────────────────────────────────────────────
// Every alert is also kept in `notifications`, so the bell in the header can
// list the last 30 days once the push itself is gone (profile_id null: the
// whole account). Keeping it never stops an alert: a failed insert (before
// the table's migration has run, say) only logs a warning.
const INBOX_DAYS = 30;
const INBOX_CHUNK = 500;

// Push text ends "Tap to watch." — the inbox is clicked as often as tapped.
function inboxText(text) {
  return String(text || '').replace(/\s*Tap to [^.]*\.\s*$/, '').trim();
}

function inboxRow({ userId, profileId = null, kind, title, body = '', url = null }) {
  return {
    user_id: userId,
    profile_id: profileId || null,
    kind,
    title: inboxText(title).slice(0, 200),
    body: inboxText(body).slice(0, 500),
    url: typeof url === 'string' && url.startsWith('/') ? url.slice(0, 500) : null,
  };
}

// The rows kept, with their ids ({ id, user_id, profile_id }), for the
// pushes to carry (pushPayload).
async function recordNotifications(db, rows) {
  const kept = [];
  for (let start = 0; start < rows.length; start += INBOX_CHUNK) {
    const chunk = rows.slice(start, start + INBOX_CHUNK);
    try {
      // eslint-disable-next-line no-await-in-loop
      const { data, error } = await db.from('notifications').insert(chunk).select('id, user_id, profile_id');
      if (error) throw error;
      kept.push(...(data || []));
    } catch (error) {
      console.warn('[inbox] alerts not kept:', error.message);
    }
  }
  return kept;
}

// One device's push, carrying the id of its own inbox row so that opening the
// push marks the row read (public/sw.js adds it to the link as ?notif=, and
// the page marks it). Its profile's row (a device saved without a profile
// counts as defaultProfileId's), else the account's (profile_id null); a
// device with no row of its own gets the push without one.
function pushPayload(message, kept, defaultProfileId = null) {
  return (sub) => {
    const own = kept.filter((row) => row.user_id === sub.user_id);
    const profileId = sub.profile_id || defaultProfileId;
    const row = (profileId && own.find((candidate) => candidate.profile_id === profileId)) || own.find((candidate) => !candidate.profile_id);
    return JSON.stringify(row ? { ...message, inbox: row.id } : message);
  };
}

const PUSH_FIELDS = 'id, user_id, profile_id, endpoint, p256dh, auth';

async function pruneNotifications(db, now = Date.now()) {
  try {
    const { error } = await db.from('notifications').delete().lt('created_at', new Date(now - INBOX_DAYS * 86400000).toISOString());
    if (error) throw error;
  } catch (error) {
    console.warn('[inbox] old alerts not pruned:', error.message);
  }
}

// ── Email alerts ──────────────────────────────────────────────────────
// Opt-in per account (email_alerts.enabled: Settings, or the question asked
// when someone first sets a reminder). Reminders are emailed when they're
// due; new episodes and announcements the account hasn't read in the app go
// out once a day as one digest (sendEmailDigests, after the daily new-episode
// run). Game alerts aren't emailed: by the next day they're old news. Without
// SMTP (mailer.js) nothing is sent.
const DIGEST_KINDS = ['episode', 'announcement'];
const DIGEST_HOURS = 48; // a missed daily run still catches up; emailed_at stops repeats

// Map of user id → email for the accounts with email alerts on: among
// userIds, or all of them. Empty without SMTP, or before the migration.
async function emailRecipients(db, userIds = null) {
  if (!mailer.emailConfigured()) return new Map();
  const ids = userIds && [...new Set(userIds)].filter(Boolean);
  if (ids && !ids.length) return new Map();
  try {
    let query = db.from('email_alerts').select('user_id').eq('enabled', true);
    if (ids) query = query.in('user_id', ids);
    const { data: chosen, error } = await query;
    if (error) throw error;
    const on = (chosen || []).map((row) => row.user_id);
    if (!on.length) return new Map();
    const { data: people, error: peopleError } = await db.from('profiles').select('id, email').in('id', on);
    if (peopleError) throw peopleError;
    return new Map((people || []).filter((person) => person.email).map((person) => [person.id, person.email]));
  } catch (error) {
    console.warn('[email] who wants alerts couldn\'t be read:', error.message);
    return new Map();
  }
}

// One email per account with alerts on: its unread, not yet emailed new
// episodes and announcements (one per alert across its profiles).
async function sendEmailDigests(db, { now = Date.now() } = {}) {
  const recipients = await emailRecipients(db);
  const since = new Date(now - DIGEST_HOURS * 3600000).toISOString();
  let emailed = 0;
  for (const [userId, email] of recipients) {
    const { data: rows, error } = await db.from('notifications')
      .select('id, title, body, url, created_at')
      .eq('user_id', userId)
      .in('kind', DIGEST_KINDS)
      .is('emailed_at', null)
      .is('read_at', null)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error || !rows?.length) continue;
    const seen = new Set();
    const alerts = rows.filter((row) => {
      const key = `${row.title}|${row.url}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!(await mailer.sendMail({ to: email, ...digestEmail(alerts, mailer.siteUrl()) }))) continue;
    emailed += 1;
    await db.from('notifications').update({ emailed_at: new Date(now).toISOString() }).in('id', rows.map((row) => row.id));
  }
  return { accounts: recipients.size, emailed };
}

// "Remind me tonight" reminders that are due. Meant to run every ~15 min
// (Vercel Hobby crons are daily only, so schedule it from Supabase
// pg_cron — see supabase/manual/schedule_reminders.sql); the daily
// new-episodes run also sweeps it as a fallback. Pushed when push is set up
// (canPush), emailed to accounts with email alerts on, and kept in the inbox.
async function sendDueReminders(db, { canPush = true } = {}) {
  const { data: due } = await db.from('watch_reminders')
    .select('id, user_id, profile_id, title, url')
    .is('sent_at', null).is('dismissed_at', null)
    .lte('remind_at', new Date().toISOString())
    .limit(500);
  let sent = 0;
  let emailed = 0;
  const recipients = await emailRecipients(db, (due || []).map((reminder) => reminder.user_id));
  for (const reminder of due || []) {
    const message = {
      title: `Time to watch ${reminder.title}`,
      body: 'You asked binge. to remind you. Tap to start watching.',
      url: `${reminder.url}?play=1&reminder=${reminder.id}`,
    };
    const kept = await recordNotifications(db, [inboxRow({ userId: reminder.user_id, profileId: reminder.profile_id, kind: 'reminder', ...message })]);
    if (canPush) {
      let query = db.from('push_subscriptions').select(PUSH_FIELDS).eq('user_id', reminder.user_id);
      if (reminder.profile_id) query = query.eq('profile_id', reminder.profile_id);
      const { data: subs } = await query;
      const result = await pushTo(db, subs || [], pushPayload({ ...message, tag: `reminder-${reminder.id}` }, kept));
      sent += result.sent;
    }
    const email = recipients.get(reminder.user_id);
    if (email && await mailer.sendMail({ to: email, ...reminderEmail({ title: reminder.title, url: message.url }, mailer.siteUrl()) })) emailed += 1;
    await db.from('watch_reminders').update({ sent_at: new Date().toISOString() }).eq('id', reminder.id);
  }
  return { due: (due || []).length, sent, emailed };
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
          const kept = await recordNotifications(db, [inboxRow({ userId: follower.user_id, profileId: follower.profile_id, kind: 'game', ...message, url: '/sports' })]);
          let query = db.from('push_subscriptions').select(PUSH_FIELDS).eq('user_id', follower.user_id);
          if (follower.profile_id) query = query.eq('profile_id', follower.profile_id);
          const { data: subs } = await query;
          const result = await pushTo(db, subs || [], pushPayload({ ...message, url: '/sports', tag: `game-${event.id}-${alert.kind}` }, kept));
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
const PROBE_TMDB = 550; // Fight Club — on every server

// The servers probed are the player's own list (src/utils/embedServers.js, an
// ES module Vercel's build compiles to CommonJS), each at the URL the player
// would load for the film. Loaded on first use, not at startup, so a problem
// loading it can only break this check, never every /api route (see sports.js).
let embedServers = null;
function probeTargets() {
  if (!embedServers) embedServers = require('../../src/utils/embedServers');
  return embedServers.EMBED_SERVERS
    .filter((server) => server.types.includes('movie') && server.idKinds.includes('tmdb'))
    .map((server) => [server.id, server.label, server.buildUrl({ kind: 'tmdb', value: String(PROBE_TMDB) }, 'movie', 1, 1, null, {})]);
}
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
  // The inbox draws its own icons: no status emoji in its text.
  const plain = (text) => text.replace(/\p{Extended_Pictographic}\uFE0F?\s*/gu, '');
  const kept = await recordNotifications(db, ids.map((id) => inboxRow({ userId: id, kind: 'server', title: plain(title), body: plain(body), url: '/admin?tab=servers' })));
  const { data: subs } = await db.from('push_subscriptions').select(PUSH_FIELDS).in('user_id', ids);
  await pushTo(db, subs || [], pushPayload({ title, body, url: '/admin', tag: `server-${title}` }, kept));
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
  const results = await Promise.all(probeTargets().map(async ([provider, label, url]) => ({ provider, label, ...(await probe(url)) })));
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
  // Reminders go out by push, email or both; game alerts and the server check
  // need push.
  const pushDb = setupPush();
  const db = pushDb || (mailer.emailConfigured() ? getAdminClient() : null);
  if (!db) return res.status(503).json({ error: 'neither push nor email is configured' });
  try {
    // The same frequent job also checks followed teams' games.
    const [reminders, games, servers] = await Promise.all([
      sendDueReminders(db, { canPush: Boolean(pushDb) }),
      pushDb ? sendGameAlerts(db).catch((err) => ({ error: err.message })) : null,
      pushDb ? checkServers(db).catch((err) => ({ error: err.message })) : null, // throttled to every 15 min
    ]);
    res.json({ ...reminders, games, servers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Which of an account's profiles follow each show (its list, unless finished,
// and Continue Watching): Map of tv_shows.id → Set of profile ids. A row saved
// without a profile is the default profile's, as everywhere else.
function showFollowers(profiles, listRows, watchingRows) {
  const ids = new Set(profiles.map((profile) => profile.id));
  const fallback = (profiles.find((profile) => profile.is_default) || profiles[0])?.id || null;
  const follows = new Map();
  const add = (row) => {
    const showId = Number(row.media_id);
    if (!Number.isFinite(showId)) return;
    if (!follows.has(showId)) follows.set(showId, new Set());
    follows.get(showId).add(ids.has(row.profile_id) ? row.profile_id : fallback);
  };
  listRows.filter((row) => row.status !== 'watched').forEach(add);
  watchingRows.forEach(add);
  return follows;
}

// Every profile following a show gets its new episode in the inbox; the
// devices of those profiles get a push when canPush (a device saved without a
// profile counts as the default profile's). push_notified claims each episode
// once per account before anything is sent, so a re-run never repeats one.
async function sendNewEpisodeAlerts(db, { canPush = false, latest = latestEpisode, now = Date.now() } = {}) {
  const [{ data: profiles, error }, { data: subs }] = await Promise.all([
    db.from('account_profiles').select('id, account_id, is_default'),
    canPush ? db.from('push_subscriptions').select('id, user_id, profile_id, endpoint, p256dh, auth') : Promise.resolve({ data: [] }),
  ]);
  if (error) throw new Error(error.message);
  const accounts = new Map();
  (profiles || []).forEach((profile) => accounts.set(profile.account_id, [...(accounts.get(profile.account_id) || []), profile]));

  const cutoff = now - NEW_WITHIN_DAYS * 86400000;
  const episodes = new Map(); // tv_shows.id → its latest aired episode, one TMDB call per run
  const totals = { accounts: accounts.size, alerts: 0, sent: 0, removedSubscriptions: 0 };

  for (const [userId, accountProfiles] of accounts) {
    const [{ data: list }, { data: watching }] = await Promise.all([
      db.from('watchlist').select('media_id, status, profile_id').eq('user_id', userId).eq('media_type', 'tv_show'),
      db.from('continue_watching').select('media_id, profile_id').eq('user_id', userId).eq('media_type', 'tv_show'),
    ]);
    const follows = showFollowers(accountProfiles, list || [], watching || []);
    const showIds = [...follows.keys()].slice(0, 100);
    if (!showIds.length) continue;
    const defaultId = (accountProfiles.find((profile) => profile.is_default) || accountProfiles[0]).id;

    const { data: shows } = await db.from('tv_shows').select('id, title, source_key').in('id', showIds);
    for (const show of shows || []) {
      const tmdbId = String(show.source_key || '').match(/^tmdb:tv:(\d+)$/)?.[1];
      if (!tmdbId) continue;
      if (!episodes.has(show.id)) episodes.set(show.id, (await latest(tmdbId).catch(() => null))?.last || null);
      const last = episodes.get(show.id);
      if (!last?.air_date || new Date(`${last.air_date}T23:59:59Z`).getTime() < cutoff) continue;

      const followers = [...(follows.get(Number(show.id)) || [])];
      const episodeKey = `S${last.season_number}E${last.episode_number}`;
      const { error: claimed } = await db.from('push_notified').insert({
        user_id: userId, profile_id: followers.length === 1 ? followers[0] : null, media_id: show.id, episode_key: episodeKey,
      });
      if (claimed) continue; // already alerted (or can't be recorded: don't risk repeating it)

      const message = {
        title: `New episode: ${show.title}`,
        body: `S${last.season_number} · E${last.episode_number}${last.name ? ` — ${last.name}` : ''} is out now.`,
        url: `/tv-show/${show.id}?play=1&season=${last.season_number}&episode=${last.episode_number}`,
      };
      const kept = await recordNotifications(db, followers.map((profileId) => inboxRow({ userId, profileId, kind: 'episode', ...message })));
      totals.alerts += kept.length;
      const wanted = new Set(followers);
      const devices = (subs || []).filter((sub) => sub.user_id === userId && wanted.has(sub.profile_id || defaultId));
      if (devices.length) {
        const result = await pushTo(db, devices, pushPayload({ ...message, tag: `new-episode-${show.id}` }, kept, defaultId));
        totals.sent += result.sent;
        totals.removedSubscriptions += result.removed;
      }
    }
  }
  return totals;
}

router.get('/new-episodes', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' });
  // Push is optional here: without VAPID keys the inbox still gets its alerts.
  const pushDb = setupPush();
  const db = pushDb || getAdminClient();
  if (!db) return res.status(503).json({ error: 'database not configured' });
  const reminders = pushDb || mailer.emailConfigured() ? await sendDueReminders(db, { canPush: Boolean(pushDb) }).catch(() => null) : null;
  await pruneNotifications(db);
  try {
    const alerts = await sendNewEpisodeAlerts(db, { canPush: Boolean(pushDb) });
    // After the alerts, so today's new episodes are in today's digest.
    const emails = await sendEmailDigests(db).catch((err) => ({ error: err.message }));
    res.json({ ...alerts, reminders, emails });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.gameAlerts = gameAlerts;
module.exports.checkServers = checkServers;
module.exports.probeTargets = probeTargets;
module.exports.pushTo = pushTo;
module.exports.setupPush = setupPush;
module.exports.inboxRow = inboxRow;
module.exports.recordNotifications = recordNotifications;
module.exports.pushPayload = pushPayload;
module.exports.PUSH_FIELDS = PUSH_FIELDS;
module.exports.pruneNotifications = pruneNotifications;
module.exports.sendNewEpisodeAlerts = sendNewEpisodeAlerts;
module.exports.sendDueReminders = sendDueReminders;
module.exports.sendEmailDigests = sendEmailDigests;
module.exports.emailRecipients = emailRecipients;
