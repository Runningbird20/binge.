import { fetchProfileLocks } from './profileLocks';
import { requireSupabaseClient } from './supabase';
jest.mock('./supabase', () => ({ requireSupabaseClient: jest.fn() }));
let client;
let limit;
beforeEach(() => {
  limit = jest.fn();
  client = { rpc: jest.fn(), from: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ limit }) }) };
  requireSupabaseClient.mockReturnValue(client);
});
test('returns configured profile locks', async () => {
  client.rpc.mockResolvedValue({ data: [{ profile_id: 'locked-profile' }] });
  expect(await fetchProfileLocks()).toEqual({ ids: new Set(['locked-profile']), available: true });
});
test('allows profiles when the lock function AND storage are not installed', async () => {
  client.rpc.mockResolvedValue({ error: { code: 'PGRST202' } });
  limit.mockResolvedValue({ error: { code: 'PGRST205' } });
  expect(await fetchProfileLocks()).toEqual({ ids: new Set(), available: false });
});
test('never bypasses existing locks when only the function is missing', async () => {
  client.rpc.mockResolvedValue({ error: { code: 'PGRST202' } });
  limit.mockResolvedValue({ error: { code: '42501' } });
  await expect(fetchProfileLocks()).rejects.toThrow('Unable to check');
});
test('does not unlock profiles after network failures', async () => {
  client.rpc.mockRejectedValue(new Error('Network failure'));
  await expect(fetchProfileLocks()).rejects.toThrow();
});
