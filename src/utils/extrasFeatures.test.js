import { buildIcs } from './releaseCalendar';
import { isConversational } from './aiSearch';
import { CURATED_FRANCHISES, curatedFranchiseFor } from './franchises';

jest.mock('./supabaseData', () => ({}));
jest.mock('./catalogLookup', () => ({ resolveTmdbItems: jest.fn() }));
jest.mock('../api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));

describe('release calendar .ics', () => {
  it('writes all-day events with escaped text and links', () => {
    const ics = buildIcs([{ id: 'ep:1:2:3', date: '2026-10-20', title: 'The Bear', detail: 'S4 · E3 — “Fish, Chips”', url: '/tv-show/1' }], 'https://binge.test');
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261020');
    expect(ics).toContain('DTEND;VALUE=DATE:20261021');
    expect(ics).toContain('SUMMARY:The Bear: S4 · E3 — “Fish\\, Chips”');
    expect(ics).toContain('URL:https://binge.test/tv-show/1');
    expect(ics.split('\r\n').filter((line) => line === 'BEGIN:VEVENT')).toHaveLength(1);
  });

  it('rolls the end date over month boundaries', () => {
    expect(buildIcs([{ id: 'x', date: '2026-12-31', title: 'A', detail: 'B', url: '/' }], 'https://b')).toContain('DTEND;VALUE=DATE:20270101');
  });
});

describe('Ask binge. triggers', () => {
  it('treats sentences as conversational', () => {
    expect(isConversational('something like Arrival but less slow')).toBe(true);
    expect(isConversational('funny movie for tonight')).toBe(true);
  });
  it('leaves title searches alone', () => {
    expect(isConversational('dune')).toBe(false);
    expect(isConversational('breaking bad')).toBe(false);
    expect(isConversational('the dark knight')).toBe(false);
  });
});

describe('curated franchises', () => {
  it('story and release orders contain the same films', () => {
    Object.values(CURATED_FRANCHISES).forEach((franchise) => {
      expect([...franchise.story].sort()).toEqual([...franchise.release].sort());
      expect(new Set(franchise.release).size).toBe(franchise.release.length);
    });
  });
  it('finds the MCU from any member (not its sub-collection)', () => {
    expect(curatedFranchiseFor(10138)?.[0]).toBe('mcu'); // Iron Man 2
    expect(curatedFranchiseFor(9615)?.[0]).toBe('fast'); // Tokyo Drift
    expect(curatedFranchiseFor(155)).toBeNull(); // The Dark Knight → TMDB collection
  });
  it('puts Tokyo Drift after Fast & Furious 6 in story order', () => {
    const { story } = CURATED_FRANCHISES.fast;
    expect(story.indexOf(9615)).toBe(story.indexOf(82992) + 1);
  });
});
