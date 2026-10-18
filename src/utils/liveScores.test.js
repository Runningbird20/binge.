import { periodLabel } from './liveScores';

describe('periodLabel', () => {
  it('numbers regulation periods', () => {
    expect(periodLabel('football/nfl', 4)).toBe('4');
    expect(periodLabel('basketball/nba', 3)).toBe('3');
    expect(periodLabel('hockey/nhl', 3)).toBe('3');
  });

  it('labels football overtimes OT, 2OT…', () => {
    expect(periodLabel('football/nfl', 5)).toBe('OT');
    expect(periodLabel('football/college-football', 7)).toBe('3OT');
  });

  it('labels basketball overtimes after 4 quarters, or 2 halves in men’s college', () => {
    expect(periodLabel('basketball/nba', 5)).toBe('OT');
    expect(periodLabel('basketball/wnba', 6)).toBe('2OT');
    expect(periodLabel('basketball/mens-college-basketball', 3)).toBe('OT');
    expect(periodLabel('basketball/mens-college-basketball', 2)).toBe('2');
  });

  it('labels hockey OT, then a shootout in the regular season but more OTs in the playoffs', () => {
    expect(periodLabel('hockey/nhl', 4, 2)).toBe('OT');
    expect(periodLabel('hockey/nhl', 5, 2)).toBe('SO');
    expect(periodLabel('hockey/nhl', 5, 3)).toBe('2OT');
    expect(periodLabel('hockey/nhl', 7, 3)).toBe('4OT');
  });

  it('leaves other sports numbered', () => {
    expect(periodLabel('baseball/mlb', 10)).toBe('10');
    expect(periodLabel('soccer/eng.1', 3)).toBe('3');
  });
});
