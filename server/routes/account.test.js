const test = require('node:test');
const assert = require('node:assert/strict');
const { createDeleteHandler, _failedAttempts } = require('./account');

const USER = { id: 'user-1', email: 'viewer@example.com' };

// A service-role client stand-in: profiles lookups and auth.admin.deleteUser.
function fakeAdmin({ isAdmin = false, adminCount = 1, deleteError = null } = {}) {
  const calls = { deleted: [] };
  const query = (head) => ({
    select: () => query(head),
    eq: () => (head ? Promise.resolve({ count: adminCount }) : query(head)),
    maybeSingle: () => Promise.resolve({ data: { is_admin: isAdmin } }),
  });
  return {
    calls,
    from: () => ({ select: (_cols, opts) => query(Boolean(opts?.head)) }),
    auth: { admin: { deleteUser: async (id) => { calls.deleted.push(id); return { error: deleteError }; } } },
  };
}

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function run(handler, body = { password: 'right' }) {
  const res = fakeRes();
  await handler({ body, headers: { authorization: 'Bearer t' } }, res);
  return res;
}

test.beforeEach(() => _failedAttempts.clear());

test('deletes the account after the password checks out, then clears its avatars', async () => {
  const admin = fakeAdmin();
  const cleared = [];
  const handler = createDeleteHandler({
    getAdmin: () => admin,
    getUser: async () => USER,
    verifyPassword: async (user, password) => user.id === USER.id && password === 'right',
    clearStorage: async (_admin, id) => { cleared.push(id); },
  });
  const res = await run(handler);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { deleted: true });
  assert.deepEqual(admin.calls.deleted, ['user-1']);
  assert.deepEqual(cleared, ['user-1']);
});

test('a wrong password deletes nothing, and five lock the form for a while', async () => {
  const admin = fakeAdmin();
  const handler = createDeleteHandler({ getAdmin: () => admin, getUser: async () => USER, verifyPassword: async () => false, clearStorage: async () => {} });
  for (let i = 0; i < 5; i += 1) assert.equal((await run(handler, { password: 'wrong' })).statusCode, 401);
  const locked = await run(handler, { password: 'wrong' });
  assert.equal(locked.statusCode, 429);
  assert.deepEqual(admin.calls.deleted, []);
});

test('needs a password and a signed-in user', async () => {
  const handler = createDeleteHandler({ getAdmin: () => fakeAdmin(), getUser: async () => null, verifyPassword: async () => true });
  assert.equal((await run(handler, {})).statusCode, 400);
  assert.equal((await run(handler)).statusCode, 401);
});

test('the only admin cannot delete themselves; one of several can', async () => {
  const only = fakeAdmin({ isAdmin: true, adminCount: 1 });
  const res = await run(createDeleteHandler({ getAdmin: () => only, getUser: async () => USER, verifyPassword: async () => true, clearStorage: async () => {} }));
  assert.equal(res.statusCode, 409);
  assert.deepEqual(only.calls.deleted, []);

  const several = fakeAdmin({ isAdmin: true, adminCount: 3 });
  const ok = await run(createDeleteHandler({ getAdmin: () => several, getUser: async () => USER, verifyPassword: async () => true, clearStorage: async () => {} }));
  assert.equal(ok.statusCode, 200);
});

test('a failed delete reports an error and leaves the avatars alone', async () => {
  const admin = fakeAdmin({ deleteError: new Error('db down') });
  let cleared = false;
  const res = await run(createDeleteHandler({ getAdmin: () => admin, getUser: async () => USER, verifyPassword: async () => true, clearStorage: async () => { cleared = true; } }));
  assert.equal(res.statusCode, 500);
  assert.equal(cleared, false);
});

test('without the service-role key the route says so instead of failing oddly', async () => {
  const res = await run(createDeleteHandler({ getAdmin: () => null }));
  assert.equal(res.statusCode, 503);
});
