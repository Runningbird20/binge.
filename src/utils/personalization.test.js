import { pickBecauseRows } from './personalization';

describe('pickBecauseRows', () => {
  const row = (key, language, genre) => ({ id: key, seed: { key, language, genre, polarity: 1, weight: 1 } });

  test('keeps the strongest seed and prefers different flavours', () => {
    const rows = [row('a', 'ko', 'Drama'), row('b', 'ko', 'Drama'), row('c', 'en', 'Comedy'), row('d', 'en', 'Crime')];
    const picked = pickBecauseRows(rows, 3);
    expect(picked[0].id).toBe('a');
    expect(picked.map((r) => r.id)).not.toContain('b');
    expect(picked).toHaveLength(3);
  });

  test('fills with look-alikes only when nothing else is left', () => {
    const rows = [row('a', 'ko', 'Drama'), row('b', 'ko', 'Drama')];
    expect(pickBecauseRows(rows, 3).map((r) => r.id)).toEqual(['a', 'b']);
  });
});
