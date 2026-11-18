import { anilistQuery } from './anilist';

beforeEach(() => { global.fetch = jest.fn(); });

describe('anilistQuery', () => {
  it('turns rate limiting into a friendly error', async () => {
    global.fetch.mockResolvedValue({ status: 429, ok: false, headers: { get: () => '30' }, json: async () => ({}) });
    await expect(anilistQuery('{ rateTest }')).rejects.toMatchObject({ status: 429, message: expect.stringMatching(/busy.*30 seconds/) });
  });
  it('reports network failures', async () => {
    global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(anilistQuery('{ networkTest }')).rejects.toMatchObject({ status: 0 });
  });
  it('reports malformed responses / GraphQL errors', async () => {
    global.fetch.mockResolvedValue({ status: 200, ok: true, headers: { get: () => null }, json: async () => ({ errors: [{ message: 'Bad field' }] }) });
    await expect(anilistQuery('{ badTest }')).rejects.toThrow('Bad field');
  });
});

describe('shared requests', () => {
  it('a caller aborting does not cancel the request for the next caller', async () => {
    let release;
    global.fetch.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const first = new AbortController();
    const firstCall = anilistQuery('{ sharedTest }', {}, first.signal);
    first.abort();
    await expect(firstCall).rejects.toMatchObject({ name: 'AbortError' });
    const second = anilistQuery('{ sharedTest }', {}, new AbortController().signal);
    release({ status: 200, ok: true, headers: { get: () => null }, json: async () => ({ data: { ok: 1 } }) });
    await expect(second).resolves.toEqual({ ok: 1 });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
