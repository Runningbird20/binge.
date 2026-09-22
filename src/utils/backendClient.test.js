import { createBackendClient } from './backendClient';
import { setActiveProfileId, clearActiveProfileId } from './activeProfile';
import { normalizeMediaId } from './mediaId';

afterEach(() => { clearActiveProfileId(); jest.restoreAllMocks(); });

test('sends catalog filters to the same-origin API and preserves large IDs', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: '1152880317676263401', title: 'Book' }], error: null }) });
  setActiveProfileId('profile-id');
  const client = createBackendClient();
  const result = await client.from('books').select('id,title').eq('id', '1152880317676263401').range(0, 19);
  expect(result.data[0].id).toBe('1152880317676263401');
  const [url, options] = global.fetch.mock.calls[0];
  expect(url).toBe('/api/backend/query');
  expect(options.credentials).toBe('same-origin');
  expect(options.headers['X-Binge-Profile']).toBe('profile-id');
  expect(JSON.parse(options.body)).toMatchObject({ table: 'books', offset: 0, limit: 20, filters: [{ column: 'id', value: '1152880317676263401' }] });
});

test('admin account creation uses the authorized admin API without signing in as the new user', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { user: { id: 'created' }, session: null }, error: null }) });
  const normal = createBackendClient();
  const listener = jest.fn();
  const subscription = normal.auth.onAuthStateChange(listener);
  await createBackendClient({ admin: true }).auth.signUp({ email: 'new@example.com', password: 'password' });
  expect(global.fetch.mock.calls[0][0]).toBe('/api/admin/users');
  expect(listener).not.toHaveBeenCalled();
  subscription.data.subscription.unsubscribe();
});

test('normalizes only IDs that can be represented exactly', () => {
  expect(normalizeMediaId('123')).toBe(123);
  expect(normalizeMediaId('1152880317676263401')).toBe('1152880317676263401');
  expect(normalizeMediaId(null)).toBeNull();
});
