const test = require('node:test');
const assert = require('node:assert/strict');
const webpush = require('web-push');
const {
  inboxRow, recordNotifications, pruneNotifications, pushPayload, seasonAnnouncement, sendNewEpisodeAlerts, showFollowers,
} = require('./cron');

// A stand-in for the service-role client: records inserts (which hand back
// their new ids, like insert().select()) and deletes.
function fakeDb({ error = null, throws = false } = {}) {
  const inserts = [];
  const deletes = [];
  let nextId = 1;
  return {
    inserts,
    deletes,
    from(table) {
      return {
        insert(rows) {
          return {
            async select() {
              if (throws) throw new Error('network down');
              if (error) return { data: null, error };
              inserts.push({ table, rows });
              return { data: rows.map((row) => ({ id: nextId++, user_id: row.user_id, profile_id: row.profile_id })), error: null };
            },
          };
        },
        delete() {
          return {
            async lt(column, value) {
              if (throws) throw new Error('network down');
              deletes.push({ table, column, value });
              return { error };
            },
          };
        },
      };
    },
  };
}

test('an inbox row keeps the alert without the push-only "Tap to …"', () => {
  assert.deepEqual(inboxRow({
    userId: 'u1', profileId: 'p1', kind: 'reminder',
    title: 'Time to watch Dune', body: 'You asked binge. to remind you. Tap to start watching.', url: '/movie/7?play=1&reminder=3',
  }), {
    user_id: 'u1', profile_id: 'p1', kind: 'reminder',
    title: 'Time to watch Dune', body: 'You asked binge. to remind you.', url: '/movie/7?play=1&reminder=3',
  });
});

test('no profile means the whole account, and only links on binge. are kept', () => {
  const row = inboxRow({ userId: 'u1', kind: 'announcement', title: 'Hello', body: 'News', url: 'https://example.com' });
  assert.equal(row.profile_id, null);
  assert.equal(row.url, null);
  assert.equal(inboxRow({ userId: 'u1', kind: 'game', title: 'x'.repeat(300) }).title.length, 200);
});

test('alerts are kept in batches of 500', async () => {
  const db = fakeDb();
  const rows = Array.from({ length: 1201 }, (_, index) => inboxRow({ userId: `u${index}`, kind: 'announcement', title: 'Hi' }));
  const kept = await recordNotifications(db, rows);
  assert.equal(kept.length, 1201);
  assert.deepEqual(kept[1200], { id: 1201, user_id: 'u1200', profile_id: null });
  assert.deepEqual(db.inserts.map((insert) => [insert.table, insert.rows.length]), [['notifications', 500], ['notifications', 500], ['notifications', 201]]);
});

test('keeping an alert never stops it: a missing table or a network error only warns', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const row = inboxRow({ userId: 'u1', kind: 'episode', title: 'New episode: Severance' });
  assert.deepEqual(await recordNotifications(fakeDb({ error: { message: 'relation "notifications" does not exist' } }), [row]), []);
  assert.deepEqual(await recordNotifications(fakeDb({ throws: true }), [row]), []);
  assert.equal(warn.mock.callCount(), 2);
});

test('each device’s push carries its own inbox row: its profile’s, else the account’s', () => {
  const message = { title: 'Hi', url: '/home' };
  const kept = [
    { id: 7, user_id: 'u1', profile_id: 'pA' },
    { id: 8, user_id: 'u1', profile_id: 'pB' },
    { id: 9, user_id: 'u2', profile_id: null },
  ];
  const payload = pushPayload(message, kept, 'pA');
  const inboxOf = (sub) => JSON.parse(payload(sub)).inbox;
  assert.equal(inboxOf({ user_id: 'u1', profile_id: 'pB' }), 8);
  // Saved without a profile: the default profile's.
  assert.equal(inboxOf({ user_id: 'u1', profile_id: null }), 7);
  // An account-wide alert (a broadcast) is the account's one row, on every device.
  assert.equal(inboxOf({ user_id: 'u2', profile_id: 'pZ' }), 9);
  // No row for this device (the alert wasn't kept): the push goes without one.
  assert.deepEqual(JSON.parse(payload({ user_id: 'u3', profile_id: null })), message);
  assert.deepEqual(JSON.parse(pushPayload(message, [])({ user_id: 'u1', profile_id: 'pA' })), message);
});

test('alerts older than 30 days are deleted, and a failure there only warns', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const db = fakeDb();
  const now = Date.parse('2026-11-16T12:00:00Z');
  await pruneNotifications(db, now);
  assert.deepEqual(db.deletes, [{ table: 'notifications', column: 'created_at', value: '2026-10-17T12:00:00.000Z' }]);
  await assert.doesNotReject(pruneNotifications(fakeDb({ throws: true }), now));
  assert.equal(warn.mock.callCount(), 1);
});

// ── New-episode alerts ────────────────────────────────────────────────

// An in-memory stand-in for the tables the job reads and writes. `unique`
// lists each table's key columns (push_notified's primary key).
function memoryDb(tables, unique = { push_notified: ['user_id', 'media_id', 'episode_key'] }) {
  return {
    tables,
    from(table) {
      const filters = [];
      const query = {
        select: () => query,
        eq(column, value) { filters.push((row) => row[column] === value); return query; },
        in(column, values) { filters.push((row) => values.includes(row[column])); return query; },
        then(resolve, reject) {
          const rows = (tables[table] || []).filter((row) => filters.every((keep) => keep(row)));
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
        insert(input) {
          let result = null;
          const run = () => {
            if (result) return result;
            const rows = (Array.isArray(input) ? input : [input]).map((row) => ({ id: tables.nextId = (tables.nextId || 0) + 1, ...row }));
            const key = unique[table];
            if (key && rows.some((row) => (tables[table] || []).some((old) => key.every((column) => old[column] === row[column])))) {
              result = { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
            } else {
              tables[table] = [...(tables[table] || []), ...rows];
              result = { data: rows, error: null };
            }
            return result;
          };
          return {
            then: (resolve, reject) => Promise.resolve(run()).then(({ error }) => ({ error })).then(resolve, reject),
            select: async () => run(),
          };
        },
        async upsert(input, { onConflict }) {
          const rows = Array.isArray(input) ? input : [input];
          const keys = onConflict.split(',');
          const same = (old) => rows.some((row) => keys.every((column) => old[column] === row[column]));
          tables[table] = [...(tables[table] || []).filter((old) => !same(old)), ...rows];
          return { error: null };
        },
      };
      return query;
    },
  };
}

const TODAY = Date.parse('2026-11-16T15:00:00Z');
const EPISODES = {
  95396: { air_date: '2026-11-16', season_number: 2, episode_number: 5, name: 'Trojan’s Horse' },
  95480: { air_date: '2026-11-15', season_number: 5, episode_number: 3, name: '' },
  250307: { air_date: '2026-11-15', season_number: 2, episode_number: 1, name: '7:00 A.M.' },
  1: { air_date: '2026-10-01', season_number: 9, episode_number: 9, name: 'Long ago' },
};
const latest = async (tmdbId) => ({ last: EPISODES[tmdbId] });

function library() {
  return {
    account_profiles: [
      { id: 'pA', account_id: 'u1', is_default: true },
      { id: 'pB', account_id: 'u1', is_default: false },
      { id: 'pC', account_id: 'u2', is_default: true },
    ],
    watchlist: [
      { user_id: 'u1', media_type: 'tv_show', media_id: 10, status: 'watching', profile_id: 'pA' },
      { user_id: 'u1', media_type: 'tv_show', media_id: 10, status: 'plan_to_watch', profile_id: 'pB' },
      { user_id: 'u1', media_type: 'tv_show', media_id: 11, status: 'watched', profile_id: 'pB' },
      { user_id: 'u2', media_type: 'tv_show', media_id: 12, status: 'watching', profile_id: null },
    ],
    continue_watching: [
      { user_id: 'u1', media_type: 'tv_show', media_id: 13, profile_id: null },
    ],
    tv_shows: [
      { id: 10, title: 'Severance', source_key: 'tmdb:tv:95396' },
      { id: 11, title: 'The Pitt', source_key: 'tmdb:tv:250307' },
      { id: 12, title: 'Slow Horses', source_key: 'tmdb:tv:95480' },
      { id: 13, title: 'Old Show', source_key: 'tmdb:tv:1' },
    ],
    push_notified: [],
    notifications: [],
    push_subscriptions: [
      { id: 1, user_id: 'u1', profile_id: 'pB', endpoint: 'https://push.example/b', p256dh: 'k', auth: 'a' },
      { id: 2, user_id: 'u1', profile_id: null, endpoint: 'https://push.example/no-profile', p256dh: 'k', auth: 'a' },
      { id: 3, user_id: 'u2', profile_id: 'pZ', endpoint: 'https://push.example/someone-else', p256dh: 'k', auth: 'a' },
    ],
  };
}

test('every profile following a show gets its new episode in the inbox, notifications on or not', async () => {
  const db = memoryDb(library());
  const totals = await sendNewEpisodeAlerts(db, { latest, now: TODAY });
  assert.equal(totals.alerts, 3);
  assert.deepEqual(db.tables.notifications.map((row) => [row.user_id, row.profile_id, row.title, row.url]), [
    ['u1', 'pA', 'New episode: Severance', '/tv-show/10?play=1&season=2&episode=5'],
    ['u1', 'pB', 'New episode: Severance', '/tv-show/10?play=1&season=2&episode=5'],
    // Saved without a profile: the default profile's.
    ['u2', 'pC', 'New episode: Slow Horses', '/tv-show/12?play=1&season=5&episode=3'],
  ]);
  assert.equal(db.tables.notifications[0].body, 'S2 · E5 — Trojan’s Horse is out now.');
  // A finished show (The Pitt) and an episode from October don't count.
  assert.deepEqual(db.tables.push_notified.map((row) => [row.user_id, row.media_id, row.episode_key]), [['u1', 10, 'S2E5'], ['u2', 12, 'S5E3']]);
});

test('running again adds nothing: each episode is alerted once per account', async () => {
  const db = memoryDb(library());
  await sendNewEpisodeAlerts(db, { latest, now: TODAY });
  const again = await sendNewEpisodeAlerts(db, { latest, now: TODAY });
  assert.equal(again.alerts, 0);
  assert.equal(db.tables.notifications.length, 3);
});

test('with push set up, the devices of the profiles that follow it get the push too', async (t) => {
  const pushed = [];
  t.mock.method(webpush, 'sendNotification', async (subscription, payload) => { pushed.push([subscription.endpoint, JSON.parse(payload)]); });
  const db = memoryDb(library());
  const totals = await sendNewEpisodeAlerts(db, { canPush: true, latest, now: TODAY });
  // pB's device, and the one saved without a profile (the default profile's);
  // not a device of a profile that doesn't follow the show.
  assert.deepEqual(pushed.map(([endpoint]) => endpoint), ['https://push.example/b', 'https://push.example/no-profile']);
  assert.equal(totals.sent, 2);
  assert.equal(totals.alerts, 3);
  // Each carries its own profile's inbox row, which opening it marks read.
  const rowOf = (profileId) => db.tables.notifications.find((row) => row.profile_id === profileId).id;
  assert.deepEqual(pushed.map(([, payload]) => payload.inbox), [rowOf('pB'), rowOf('pA')]);
  assert.equal(pushed[0][1].url, '/tv-show/10?play=1&season=2&episode=5');
});

// ── The bell on a series, and new seasons ───────────────────────────

test('the bell overrides the list: on follows any show, off mutes one that’s on the list', () => {
  const profiles = [{ id: 'pA', is_default: true }, { id: 'pB' }];
  const follows = showFollowers(
    profiles,
    [{ media_id: 10, status: 'watching', profile_id: 'pA' }, { media_id: 10, status: 'plan_to_watch', profile_id: 'pB' }, { media_id: 11, status: 'watched', profile_id: 'pB' }],
    [],
    [
      { media_id: 10, profile_id: 'pB', following: false }, // muted
      { media_id: 11, profile_id: 'pB', following: true }, // finished, but followed for a new season
      { media_id: 12, profile_id: null, following: true }, // no profile: the default's
      { media_id: 13, profile_id: 'pA', following: false }, // muting what isn't followed does nothing
    ],
  );
  assert.deepEqual([...follows].map(([id, who]) => [id, [...who]]), [[10, ['pA']], [11, ['pB']], [12, ['pA']]]);
  // Everyone muted: the show is gone.
  assert.equal(showFollowers(profiles, [{ media_id: 10, status: 'watching', profile_id: 'pA' }], [], [{ media_id: 10, profile_id: 'pA', following: false }]).size, 0);
});

test('a new season says when it starts, when TMDB knows', () => {
  const show = { id: 10, title: 'Severance' };
  assert.deepEqual(seasonAnnouncement(show, { number: 3, airDate: '2027-03-04' }, TODAY), {
    title: 'New season: Severance', body: 'Season 3 starts March 4, 2027.', url: '/tv-show/10',
  });
  assert.equal(seasonAnnouncement(show, { number: 3, airDate: null }, TODAY).body, 'Season 3 is confirmed. No date yet.');
  assert.deepEqual(seasonAnnouncement(show, { number: 3, airDate: '2026-11-10' }, TODAY), {
    title: 'New season: Severance', body: 'Season 3 is out now.', url: '/tv-show/10?play=1&season=3&episode=1',
  });
});

test('a season announced since the last run alerts everyone following the show, once', async () => {
  const db = memoryDb({ ...library(), show_alerts: [], show_seasons_seen: [] });
  let seasons = 2;
  const withSeasons = async (tmdbId) => ({ last: EPISODES[tmdbId], newestSeason: { number: seasons, airDate: seasons > 2 ? '2027-03-04' : '2025-01-17' } });
  const announcements = () => db.tables.notifications.filter((row) => row.title.startsWith('New season'));

  // The first time a show is seen it's only recorded.
  await sendNewEpisodeAlerts(db, { latest: withSeasons, now: TODAY });
  assert.equal(announcements().length, 0);
  assert.equal(db.tables.show_seasons_seen.find((row) => row.media_id === 10).seasons, 2);

  seasons = 3;
  const totals = await sendNewEpisodeAlerts(db, { latest: withSeasons, now: TODAY });
  assert.deepEqual(announcements().filter((row) => row.url === '/tv-show/10').map((row) => [row.user_id, row.profile_id, row.body]), [
    ['u1', 'pA', 'Season 3 starts March 4, 2027.'],
    ['u1', 'pB', 'Season 3 starts March 4, 2027.'],
  ]);
  assert.ok(totals.seasons >= 2);
  assert.equal(db.tables.show_seasons_seen.find((row) => row.media_id === 10).seasons, 3);

  const before = announcements().length;
  await sendNewEpisodeAlerts(db, { latest: withSeasons, now: TODAY });
  assert.equal(announcements().length, before);
});

test('a show followed with the bell gets its new episode; a muted profile doesn’t', async () => {
  const db = memoryDb({
    ...library(),
    show_alerts: [
      { user_id: 'u2', profile_id: 'pC', media_id: 11, following: true }, // The Pitt, not on u2's list
      { user_id: 'u1', profile_id: 'pB', media_id: 10, following: false }, // pB muted Severance
    ],
  });
  await sendNewEpisodeAlerts(db, { latest, now: TODAY });
  const got = db.tables.notifications.map((row) => [row.user_id, row.profile_id, row.title]);
  assert.ok(got.some(([user, profile, title]) => user === 'u2' && profile === 'pC' && title === 'New episode: The Pitt'));
  assert.ok(got.some(([, profile, title]) => profile === 'pA' && title === 'New episode: Severance'));
  assert.ok(!got.some(([, profile, title]) => profile === 'pB' && title === 'New episode: Severance'));
});

// The uptime probe reads the player's own server list (src/utils/embedServers.js,
// shared with the browser), loaded on first use like the sports feeds, so a
// problem loading it can only break the probe, never every /api route.
test('starting the API doesn’t load the embed server list', () => {
  require('../app');
  const listFile = require('node:path').join('src', 'utils', 'embedServers.js');
  const loaded = Object.keys(require.cache).some((file) => file.endsWith(listFile));
  assert.equal(loaded, false);
});

test('every server the player has is probed, at the URL the player builds for Fight Club', () => {
  const { probeTargets } = require('./cron');
  const { EMBED_SERVERS } = require('../../src/utils/embedServers');
  const targets = probeTargets();
  assert.deepEqual(targets.map(([id]) => id), EMBED_SERVERS.map((server) => server.id));
  for (const [id, label, url] of targets) {
    assert.equal(label, EMBED_SERVERS.find((server) => server.id === id).label);
    assert.match(url, /^https:\/\/[^/]+\/.*550/, `${id}: ${url}`);
  }
});
