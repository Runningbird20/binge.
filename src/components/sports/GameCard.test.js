import { fireEvent, render, screen } from '@testing-library/react';
import { GameArt, artBackground, darkLogo } from './GameCard';
import { withScore, withTeamLooks } from './gameInfo';

const game = {
  id: 'g', name: 'Los Angeles Lakers vs Atlanta Hawks', category: 'Basketball', league: 'NBA', startsAt: 0,
  logos: { home: 'https://logo.example/lal.png', away: 'https://logo.example/atl.png' }, providers: [],
};
// The art's images are decorative (alt=""), so they're found by role "presentation".
const images = () => screen.getAllByRole('presentation').map((image) => image.getAttribute('src'));

test('the league’s mark sits between the two teams instead of “vs”', () => {
  render(<GameArt stream={game} />);
  const [home, league, away] = images();
  expect([home, away]).toEqual(['https://logo.example/lal.png', 'https://logo.example/atl.png']);
  expect(league).toMatch(/espncdn\.com.*nba\.png/);
  expect(screen.queryByText('VS')).toBeNull();
});

test('women’s college games get the women’s basketball mark; a league without one gets VS', () => {
  const { unmount } = render(<GameArt stream={{ ...game, league: "Women's College Basketball" }} />);
  expect(images()[1]).toMatch(/NCAASports_WomensBasketball/);
  unmount();
  render(<GameArt stream={{ ...game, league: 'EFL Championship' }} />);
  expect(screen.getByText('VS')).toBeInTheDocument();
  expect(images()).toHaveLength(2);
});

test('team colors glow in from their own sides, toned down; no colors falls back to slate', () => {
  const background = artBackground(['#c8102e', '#552583']);
  expect(background).toMatch(/at 0% 50%, #8d1129 /);
  expect(background).toMatch(/at 100% 50%, #3f2062 /);
  expect(artBackground(null)).toMatch(/at 0% 50%, #222a39 /);
  expect(artBackground(['red', 'blue'])).toMatch(/at 0% 50%, #222a39 /);
});

test('ESPN’s team colors fill in for games no feed colored, in the order of the name', () => {
  const score = { teams: [
    { name: 'Atlanta Hawks', logo: 'atl.png', color: '#c8102e' },
    { name: 'Los Angeles Lakers', logo: 'lal.png', color: '#552583' },
  ] };
  expect(withScore({ ...game, logos: null }, score)).toMatchObject({ colors: ['#552583', '#c8102e'], logos: { home: 'lal.png', away: 'atl.png' } });
  expect(withScore({ ...game, colors: ['#000001', '#000002'] }, score).colors).toEqual(['#000001', '#000002']);
});

test('team-list logos and colors fill only what a game still lacks', () => {
  const looks = { logos: { home: 'a.png', away: 'b.png' }, colors: ['#111111', '#222222'] };
  expect(withTeamLooks({ ...game, logos: null }, looks)).toMatchObject({ logos: looks.logos, colors: looks.colors });
  expect(withTeamLooks({ ...game, colors: ['#000001', '#000002'] }, looks)).toMatchObject({ logos: game.logos, colors: ['#000001', '#000002'] });
  expect(withTeamLooks(game, undefined)).toBe(game);
});

test('ESPN team logos use their dark-background version, and fall back when a team has none', () => {
  expect(darkLogo('https://a.espncdn.com/i/teamlogos/nfl/500/nyg.png')).toBe('https://a.espncdn.com/i/teamlogos/nfl/500-dark/nyg.png');
  expect(darkLogo('https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/bkn.png')).toBe('https://a.espncdn.com/i/teamlogos/nba/500-dark/scoreboard/bkn.png');
  expect(darkLogo('https://logo.example/lal.png')).toBe('https://logo.example/lal.png');
  render(<GameArt stream={{ ...game, logos: { home: 'https://a.espncdn.com/i/teamlogos/nfl/500/nyg.png', away: 'https://a.espncdn.com/i/teamlogos/nfl/500/wsh.png' } }} />);
  const home = screen.getAllByRole('presentation')[0];
  expect(home).toHaveAttribute('src', 'https://a.espncdn.com/i/teamlogos/nfl/500-dark/nyg.png');
  fireEvent.error(home);
  expect(screen.getAllByRole('presentation')[0]).toHaveAttribute('src', 'https://a.espncdn.com/i/teamlogos/nfl/500/nyg.png');
});

test('a college conference game shows its conference’s mark; a missing one falls back to the league’s', () => {
  const college = { ...game, league: 'College Football', conference: 'Atlantic Coast Conference' };
  const { unmount } = render(<GameArt stream={college} />);
  const mark = screen.getAllByRole('presentation')[1];
  expect(mark).toHaveAttribute('src', 'https://a.espncdn.com/i/teamlogos/ncaa_conf/500-dark/1.png');
  fireEvent.error(mark);
  expect(screen.getAllByRole('presentation')[1].getAttribute('src')).toMatch(/NCAASports_Football/);
  unmount();
  // A conference we have no logo for: the league's mark.
  render(<GameArt stream={{ ...college, conference: 'Some New Conference' }} />);
  expect(screen.getAllByRole('presentation')[1].getAttribute('src')).toMatch(/NCAASports_Football/);
});

test('ESPN scores bring the conference along', () => {
  const score = { teams: [{ name: 'Clemson Tigers' }, { name: 'Georgia Tech Yellow Jackets' }], conference: 'Atlantic Coast Conference' };
  expect(withScore({ ...game, name: 'Clemson vs Georgia Tech', league: 'College Football' }, score).conference).toBe('Atlantic Coast Conference');
});
