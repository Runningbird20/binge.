const test = require('node:test');
const assert = require('node:assert/strict');
const mailer = require('../mailer');
const { digestEmail, reminderEmail } = require('../alertEmails');
const { emailRecipients, sendDueReminders, sendEmailDigests } = require('./cron');

// An in-memory stand-in for the service-role client, with the filters the
// email jobs use. `failing` names tables whose reads fail (before a migration).
function tableDb(tables, { failing = [] } = {}) {
  let nextId = 100;
  return {
    tables,
    from(table) {
      const filters = [];
      let sort = null;
      let max = Infinity;
      let patch = null;
      const query = {
        select: () => query,
        eq(column, value) { filters.push((row) => row[column] === value); return query; },
        in(column, values) { filters.push((row) => values.includes(row[column])); return query; },
        is(column, value) { filters.push((row) => (row[column] ?? null) === value); return query; },
        gte(column, value) { filters.push((row) => row[column] >= value); return query; },
        lte(column, value) { filters.push((row) => row[column] <= value); return query; },
        order(column, { ascending = true } = {}) { sort = { column, ascending }; return query; },
        limit(count) { max = count; return query; },
        update(values) { patch = values; return query; },
        insert(input) {
          const rows = (Array.isArray(input) ? input : [input]).map((row) => ({ id: nextId++, ...row }));
          tables[table] = [...(tables[table] || []), ...rows];
          const result = { data: rows, error: null };
          return { then: (resolve, reject) => Promise.resolve(result).then(resolve, reject), select: async () => result };
        },
        then(resolve, reject) {
          if (failing.includes(table)) return Promise.resolve({ data: null, error: { code: 'PGRST205', message: `no table ${table}` } }).then(resolve, reject);
          let rows = (tables[table] || []).filter((row) => filters.every((keep) => keep(row)));
          if (patch) {
            rows.forEach((row) => Object.assign(row, patch));
            return Promise.resolve({ data: null, error: null }).then(resolve, reject);
          }
          if (sort) rows = [...rows].sort((a, b) => (a[sort.column] < b[sort.column] ? -1 : 1) * (sort.ascending ? 1 : -1));
          return Promise.resolve({ data: rows.slice(0, max).map((row) => ({ ...row })), error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

const NOW = Date.parse('2026-11-18T15:00:00Z');
const hoursAgo = (hours) => new Date(NOW - hours * 3600000).toISOString();

// u1 turned email alerts on, u2 turned them off, u3 was never asked.
function accounts(extra = {}) {
  return {
    email_alerts: [{ user_id: 'u1', enabled: true }, { user_id: 'u2', enabled: false }],
    profiles: [{ id: 'u1', email: 'one@example.com' }, { id: 'u2', email: 'two@example.com' }, { id: 'u3', email: 'three@example.com' }],
    notifications: [],
    watch_reminders: [],
    push_subscriptions: [],
    ...extra,
  };
}

function withMail(t, { configured = true, delivers = true } = {}) {
  const sent = [];
  t.mock.method(mailer, 'emailConfigured', () => configured);
  t.mock.method(mailer, 'siteUrl', () => 'https://binge.test');
  t.mock.method(mailer, 'sendMail', async (message) => { sent.push(message); return delivers; });
  return sent;
}

test('only accounts that turned email alerts on get them, at their address', async (t) => {
  withMail(t);
  const db = tableDb(accounts());
  assert.deepEqual([...(await emailRecipients(db))], [['u1', 'one@example.com']]);
  assert.deepEqual([...(await emailRecipients(db, ['u2', 'u3']))], []);
  assert.deepEqual([...(await emailRecipients(db, []))], []);
});

test('without SMTP, or before the migration, nobody is emailed', async (t) => {
  withMail(t, { configured: false });
  assert.equal((await emailRecipients(tableDb(accounts()))).size, 0);

  t.mock.restoreAll();
  withMail(t);
  const warn = t.mock.method(console, 'warn', () => {});
  assert.equal((await emailRecipients(tableDb(accounts(), { failing: ['email_alerts'] }))).size, 0);
  assert.equal(warn.mock.callCount(), 1);
});

test('a due reminder is emailed to an account with email alerts on, and still kept in the inbox', async (t) => {
  const sent = withMail(t);
  const db = tableDb(accounts({
    watch_reminders: [
      { id: 5, user_id: 'u1', profile_id: 'p1', title: 'Dune', url: '/movie/7', remind_at: hoursAgo(1), sent_at: null, dismissed_at: null },
      { id: 6, user_id: 'u2', profile_id: null, title: 'Alien', url: '/movie/8', remind_at: hoursAgo(1), sent_at: null, dismissed_at: null },
    ],
  }));

  const result = await sendDueReminders(db, { canPush: false });

  assert.deepEqual(result, { due: 2, sent: 0, emailed: 1 });
  assert.deepEqual(sent, [{ to: 'one@example.com', ...reminderEmail({ title: 'Dune', url: '/movie/7?play=1&reminder=5' }, 'https://binge.test') }]);
  assert.match(sent[0].text, /https:\/\/binge\.test\/movie\/7\?play=1&reminder=5/);
  assert.deepEqual(db.tables.notifications.map((row) => [row.user_id, row.kind]), [['u1', 'reminder'], ['u2', 'reminder']]);
  assert.ok(db.tables.watch_reminders.every((row) => row.sent_at));
});

test('the daily digest: one email per account of what it hasn’t read, each alert once', async (t) => {
  const sent = withMail(t);
  const episode = { kind: 'episode', title: 'New episode: Severance', body: 'S2 · E5 is out now.', url: '/tv-show/10?play=1&season=2&episode=5' };
  const db = tableDb(accounts({
    notifications: [
      // Two profiles follow Severance: one alert in the email.
      { id: 1, user_id: 'u1', profile_id: 'pA', ...episode, created_at: hoursAgo(1), read_at: null, emailed_at: null },
      { id: 2, user_id: 'u1', profile_id: 'pB', ...episode, created_at: hoursAgo(1), read_at: null, emailed_at: null },
      { id: 3, user_id: 'u1', profile_id: null, kind: 'announcement', title: 'Sports is back', body: 'New feeds.', url: '/sports', created_at: hoursAgo(5), read_at: null, emailed_at: null },
      // Read already, a game alert, too old, already emailed: not in it.
      { id: 4, user_id: 'u1', profile_id: 'pA', kind: 'episode', title: 'New episode: Andor', body: '', url: '/tv-show/2', created_at: hoursAgo(2), read_at: hoursAgo(1), emailed_at: null },
      { id: 5, user_id: 'u1', profile_id: 'pA', kind: 'game', title: 'Close game', body: '', url: '/sports', created_at: hoursAgo(2), read_at: null, emailed_at: null },
      { id: 6, user_id: 'u1', profile_id: 'pA', kind: 'episode', title: 'New episode: Old', body: '', url: '/tv-show/3', created_at: hoursAgo(60), read_at: null, emailed_at: null },
      { id: 7, user_id: 'u1', profile_id: 'pA', kind: 'episode', title: 'New episode: Sent', body: '', url: '/tv-show/4', created_at: hoursAgo(20), read_at: null, emailed_at: hoursAgo(19) },
      // Email alerts off.
      { id: 8, user_id: 'u2', profile_id: null, ...episode, created_at: hoursAgo(1), read_at: null, emailed_at: null },
    ],
  }));

  assert.deepEqual(await sendEmailDigests(db, { now: NOW }), { accounts: 1, emailed: 1 });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'one@example.com');
  assert.equal(sent[0].subject, 'New episode: Severance and 1 more');
  assert.equal(sent[0].text.match(/New episode: Severance/g).length, 1);
  assert.match(sent[0].text, /Sports is back\nNew feeds\.\nhttps:\/\/binge\.test\/sports/);
  assert.doesNotMatch(sent[0].text, /Andor|Close game|Old|Sent/);
  const emailed = db.tables.notifications.filter((row) => row.emailed_at === new Date(NOW).toISOString()).map((row) => row.id);
  assert.deepEqual(emailed.sort(), [1, 2, 3]);

  // Run again: nothing new, nothing sent.
  assert.deepEqual(await sendEmailDigests(db, { now: NOW }), { accounts: 1, emailed: 0 });
  assert.equal(sent.length, 1);
});

test('an email that doesn’t go out isn’t marked sent, so the next run tries again', async (t) => {
  withMail(t, { delivers: false });
  const db = tableDb(accounts({
    notifications: [{ id: 1, user_id: 'u1', profile_id: null, kind: 'announcement', title: 'Hi', body: '', url: '/home', created_at: hoursAgo(1), read_at: null, emailed_at: null }],
  }));
  assert.deepEqual(await sendEmailDigests(db, { now: NOW }), { accounts: 1, emailed: 0 });
  assert.equal(db.tables.notifications[0].emailed_at, null);
});

test('a long digest lists 20 and links to the rest; every email says how to turn them off', () => {
  const alerts = Array.from({ length: 23 }, (_, index) => ({ title: `New episode: Show ${index + 1}`, body: '', url: `/tv-show/${index + 1}` }));
  const { subject, text } = digestEmail(alerts, 'https://binge.test');
  assert.equal(subject, 'New episode: Show 1 and 22 more');
  assert.match(text, /Show 20\n/);
  assert.doesNotMatch(text, /Show 21/);
  assert.match(text, /…and 3 more in binge\.: https:\/\/binge\.test\/home/);
  assert.match(text, /Turn them off in Settings: https:\/\/binge\.test\/settings/);
  assert.match(reminderEmail({ title: 'Dune', url: '/movie/7' }, 'https://binge.test').text, /Turn them off in Settings/);
  assert.equal(reminderEmail({ title: 'Line\nbreak', url: '/movie/7' }, 'https://b').subject, 'Time to watch Line break');
});
