const test = require('node:test');
const assert = require('node:assert/strict');
const { createPasswordResetHandler } = require('./passwordReset');

const NOW = Date.parse('2026-11-24T12:00:00Z');

// The accounts as Supabase would answer: profiles by email, then the auth user.
function fakeAccounts(users = {}) {
  const tokens = [];
  return {
    tokens,
    async find(email) { return users[email] || null; },
    async recoveryToken(email) { tokens.push(email); return `hash-${tokens.length}`; },
  };
}

function setup({ users, accounts = fakeAccounts(users), mailWorks = true, configured = true, limiter } = {}) {
  const mail = [];
  const handler = createPasswordResetHandler({
    getAccounts: () => accounts,
    sendMail: async (message) => { mail.push(message); return mailWorks; },
    emailConfigured: () => configured,
    site: () => 'https://binge.test',
    now: () => NOW,
    ...(limiter ? { ipLimiter: limiter } : {}),
  });
  return { handler, mail, accounts };
}

async function call(handler, body, ip = '1.2.3.4') {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
  await handler({ body, headers: { 'x-real-ip': ip } }, res);
  return res;
}

const alex = { id: 'u1', email: 'alex@binge.test', recovery_sent_at: null };

test('emails a link to the site with the recovery token', async () => {
  const { handler, mail, accounts } = setup({ users: { 'alex@binge.test': alex } });
  const res = await call(handler, { email: '  Alex@Binge.test ' });
  assert.deepEqual(res.body, { sent: true });
  assert.deepEqual(accounts.tokens, ['alex@binge.test']);
  assert.equal(mail.length, 1);
  assert.equal(mail[0].to, 'alex@binge.test');
  assert.equal(mail[0].subject, 'Reset your binge. password');
  assert.match(mail[0].text, /https:\/\/binge\.test\/reset-password\?token_hash=hash-1&type=recovery/);
  assert.match(mail[0].text, /https:\/\/binge\.test\/forgot-password/);
});

test('answers the same for an address with no account, and sends nothing', async () => {
  const { handler, mail, accounts } = setup({ users: {} });
  const res = await call(handler, { email: 'nobody@binge.test' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { sent: true });
  assert.equal(mail.length, 0);
  assert.equal(accounts.tokens.length, 0);
});

test('sends at most one email a minute per account', async () => {
  const recent = { ...alex, recovery_sent_at: new Date(NOW - 30 * 1000).toISOString() };
  const { handler, mail } = setup({ users: { 'alex@binge.test': recent } });
  assert.deepEqual((await call(handler, { email: 'alex@binge.test' })).body, { sent: true });
  assert.equal(mail.length, 0);

  const older = { ...alex, recovery_sent_at: new Date(NOW - 90 * 1000).toISOString() };
  const again = setup({ users: { 'alex@binge.test': older } });
  await call(again.handler, { email: 'alex@binge.test' });
  assert.equal(again.mail.length, 1);
});

test('rejects an address that is not one', async () => {
  const { handler } = setup();
  const res = await call(handler, { email: 'not-an-email' });
  assert.equal(res.statusCode, 400);
});

test('limits asks per IP', async () => {
  const { handler } = setup({ users: {}, limiter: () => true });
  const res = await call(handler, { email: 'alex@binge.test' });
  assert.equal(res.statusCode, 429);
});

test('tells the page to use Supabase’s own email when SMTP or the service role is missing', async () => {
  const noSmtp = setup({ users: { 'alex@binge.test': alex }, configured: false });
  assert.deepEqual((await call(noSmtp.handler, { email: 'alex@binge.test' })).body, { fallback: true });
  assert.equal(noSmtp.mail.length, 0);

  const noService = setup({ accounts: null });
  assert.deepEqual((await call(noService.handler, { email: 'alex@binge.test' })).body, { fallback: true });
});

test('says so when the email could not be sent', async () => {
  const { handler } = setup({ users: { 'alex@binge.test': alex }, mailWorks: false });
  const res = await call(handler, { email: 'alex@binge.test' });
  assert.equal(res.statusCode, 502);
  assert.match(res.body.error, /Try again in a minute/);
});

test('a Supabase failure is a 500, not a crash', async () => {
  const accounts = { async find() { throw new Error('down'); }, async recoveryToken() { return null; } };
  const { handler } = setup({ accounts });
  const original = console.error;
  console.error = () => {};
  try {
    const res = await call(handler, { email: 'alex@binge.test' });
    assert.equal(res.statusCode, 500);
  } finally {
    console.error = original;
  }
});
