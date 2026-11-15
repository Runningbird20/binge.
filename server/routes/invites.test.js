const test = require('node:test');
const assert = require('node:assert/strict');
const { createInviteHandlers, hash } = require('./invites');

// An in-memory stand-in for the account_requests table + profiles + auth.
function fakeStore({ accounts = [], usernames = [], admins = ['admin@binge.test'] } = {}) {
  const rows = [];
  const created = [];
  let next = 1;
  return {
    rows,
    created,
    async emailHasAccount(email) { return accounts.includes(email); },
    async usernameTaken(name) { return usernames.includes(name); },
    async findOpenByEmail(email) { return rows.find((row) => row.email === email && ['pending', 'approved'].includes(row.status)) || null; },
    async countSince(iso) { return rows.filter((row) => row.created_at >= iso).length; },
    async insert(row) {
      const saved = { id: `req-${next++}`, status: 'pending', note: '', created_at: new Date().toISOString(), ...row };
      rows.push(saved);
      return saved;
    },
    async findBy(column, value) { return rows.find((row) => row[column] === value) || null; },
    async update(id, patch) { const row = rows.find((entry) => entry.id === id); Object.assign(row, patch); return row; },
    async list() { return [...rows].reverse(); },
    async adminEmails() { return admins; },
    async createUser(attributes) {
      if (accounts.includes(attributes.email)) return { data: null, error: { code: 'email_exists', message: 'already registered' } };
      created.push(attributes);
      return { data: { user: { id: `user-${created.length}`, created_at: new Date().toISOString() } }, error: null };
    },
  };
}

function setup(options = {}) {
  const store = options.store || fakeStore(options);
  const mail = [];
  const handlers = createInviteHandlers({
    getStore: () => store,
    sendMail: async (message) => { mail.push(message); return options.mailWorks ?? true; },
    site: () => 'https://binge.test',
    now: options.now,
  });
  return { store, mail, handlers };
}

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function call(handler, { body = {}, query = {}, params = {}, ip = '1.2.3.4' } = {}) {
  const res = fakeRes();
  await handler({ body, query, params, headers: { 'x-real-ip': ip } }, res);
  return res;
}

const tokenIn = (text, path) => new RegExp(`${path}\\?(?:token|invite)=([A-Za-z0-9_-]+)`).exec(text)?.[1];

test('a request is saved and the admin gets a review link on the site’s own address', async () => {
  const { store, mail, handlers } = setup();
  const res = await call(handlers.requestAccount, { body: { name: 'Leia Organa', email: ' Leia@Example.com ', note: 'Friend of Luke' } });
  assert.deepEqual(res.body, { ok: true });
  assert.equal(store.rows.length, 1);
  assert.equal(store.rows[0].email, 'leia@example.com');
  assert.equal(mail.length, 1);
  assert.equal(mail[0].to, 'admin@binge.test');
  assert.equal(mail[0].replyTo, 'leia@example.com');
  const token = tokenIn(mail[0].text, 'https://binge.test/account-requests/review');
  assert.ok(token, 'the email links to the review page');
  assert.equal(store.rows[0].review_token_hash, hash(token)); // only the hash is kept
});

test('ACCOUNT_REQUESTS_TO decides who gets the request, else every admin', async () => {
  process.env.ACCOUNT_REQUESTS_TO = 'luke@example.com, owner@example.com';
  try {
    const { mail, handlers } = setup();
    await call(handlers.requestAccount, { body: { name: 'Han', email: 'han@example.com' } });
    assert.equal(mail[0].to, 'luke@example.com, owner@example.com');
  } finally {
    delete process.env.ACCOUNT_REQUESTS_TO;
  }
});

test('approving emails an invite; the invite makes the account, once', async () => {
  const { store, mail, handlers } = setup();
  await call(handlers.requestAccount, { body: { name: 'Leia', email: 'leia@example.com' } });
  const reviewToken = tokenIn(mail[0].text, 'https://binge.test/account-requests/review');

  const review = await call(handlers.reviewRequest, { query: { token: reviewToken } });
  assert.equal(review.body.request.email, 'leia@example.com');
  assert.equal(review.body.request.status, 'pending');

  const decided = await call(handlers.decideByToken, { body: { token: reviewToken, decision: 'approve' } });
  assert.equal(decided.body.request.status, 'approved');
  assert.equal(decided.body.emailed, true);
  assert.equal(mail[1].to, 'leia@example.com');
  const inviteToken = tokenIn(mail[1].text, 'https://binge.test/signup');
  assert.ok(inviteToken);
  assert.equal(decided.body.inviteLink, `https://binge.test/signup?invite=${inviteToken}`);

  // Deciding again changes nothing.
  const again = await call(handlers.decideByToken, { body: { token: reviewToken, decision: 'deny' } });
  assert.equal(again.body.already, true);
  assert.equal(again.body.request.status, 'approved');

  const info = await call(handlers.inviteInfo, { query: { token: inviteToken } });
  assert.deepEqual(info.body, { email: 'leia@example.com', name: 'Leia' });

  const made = await call(handlers.signup, { body: { token: inviteToken, username: 'leia', password: 'hope1977', bio: 'Rebel', avatarUrl: 'data:image/png;base64,AAA', is_admin: true } });
  assert.deepEqual(made.body, { email: 'leia@example.com' });
  assert.deepEqual(store.created[0], {
    email: 'leia@example.com',
    password: 'hope1977',
    email_confirm: true,
    user_metadata: { username: 'leia', bio: 'Rebel', avatar_url: null }, // no is_admin, no inline image
  });
  assert.equal(store.rows[0].status, 'used');

  const reused = await call(handlers.signup, { body: { token: inviteToken, username: 'leia2', password: 'hope1977' } });
  assert.equal(reused.statusCode, 410);
  assert.equal((await call(handlers.inviteInfo, { query: { token: inviteToken } })).body.used, true);
});

test('an invite expires after 14 days', async () => {
  let clock = new Date('2026-11-10T12:00:00Z');
  const { mail, handlers } = setup({ now: () => clock });
  await call(handlers.requestAccount, { body: { name: 'Leia', email: 'leia@example.com' } });
  await call(handlers.decideByToken, { body: { token: tokenIn(mail[0].text, 'https://binge.test/account-requests/review'), decision: 'approve' } });
  const inviteToken = tokenIn(mail[1].text, 'https://binge.test/signup');
  clock = new Date('2026-11-25T12:00:00Z');
  const info = await call(handlers.inviteInfo, { query: { token: inviteToken } });
  assert.equal(info.statusCode, 410);
  const made = await call(handlers.signup, { body: { token: inviteToken, username: 'leia', password: 'hope1977' } });
  assert.equal(made.statusCode, 410);
});

test('asking again, or with an address that has an account, says the same and emails nobody', async () => {
  const { store, mail, handlers } = setup({ accounts: ['member@example.com'] });
  await call(handlers.requestAccount, { body: { name: 'Leia', email: 'leia@example.com' } });
  const again = await call(handlers.requestAccount, { body: { name: 'Leia', email: 'LEIA@example.com' } });
  const member = await call(handlers.requestAccount, { body: { name: 'Member', email: 'member@example.com' } });
  assert.deepEqual(again.body, { ok: true });
  assert.deepEqual(member.body, { ok: true });
  assert.equal(store.rows.length, 1);
  assert.equal(mail.length, 1);
});

test('bad input and too many requests from one address are refused', async () => {
  const { handlers } = setup();
  assert.equal((await call(handlers.requestAccount, { body: { name: '', email: 'a@b.co' } })).statusCode, 400);
  assert.equal((await call(handlers.requestAccount, { body: { name: 'A', email: 'not-an-email' } })).statusCode, 400);
  for (let i = 0; i < 5; i += 1) await call(handlers.requestAccount, { body: { name: 'A', email: `a${i}@b.co` }, ip: '9.9.9.9' });
  assert.equal((await call(handlers.requestAccount, { body: { name: 'A', email: 'a9@b.co' }, ip: '9.9.9.9' })).statusCode, 429);
});

test('a denied request gets no invite; a wrong token gets nothing', async () => {
  const { mail, handlers } = setup();
  await call(handlers.requestAccount, { body: { name: 'Leia', email: 'leia@example.com' } });
  const denied = await call(handlers.decideByToken, { body: { token: tokenIn(mail[0].text, 'https://binge.test/account-requests/review'), decision: 'deny' } });
  assert.equal(denied.body.request.status, 'denied');
  assert.equal(mail.length, 1);
  assert.equal((await call(handlers.reviewRequest, { query: { token: 'x'.repeat(43) } })).statusCode, 404);
  assert.equal((await call(handlers.reviewRequest, { query: { token: '../etc' } })).statusCode, 404);
});

test('a taken username is refused before the account is made', async () => {
  const { store, mail, handlers } = setup({ usernames: ['leia'] });
  await call(handlers.requestAccount, { body: { name: 'Leia', email: 'leia@example.com' } });
  await call(handlers.decideByToken, { body: { token: tokenIn(mail[0].text, 'https://binge.test/account-requests/review'), decision: 'approve' } });
  const made = await call(handlers.signup, { body: { token: tokenIn(mail[1].text, 'https://binge.test/signup'), username: 'leia', password: 'hope1977' } });
  assert.equal(made.statusCode, 409);
  assert.equal(store.created.length, 0);
  assert.equal(store.rows[0].status, 'approved'); // the invite still works with another name
});

test('without email, approving still works and hands back the invite link', async () => {
  const { store, handlers } = setup({ mailWorks: false });
  await call(handlers.requestAccount, { body: { name: 'Leia', email: 'leia@example.com' } });
  const listed = await call(handlers.adminList);
  assert.equal(listed.body.pending, 1);
  const decided = await call(handlers.adminDecide, { params: { id: store.rows[0].id }, body: { decision: 'approve' } });
  assert.equal(decided.body.emailed, false);
  assert.match(decided.body.inviteLink, /^https:\/\/binge\.test\/signup\?invite=[A-Za-z0-9_-]+$/);
});
