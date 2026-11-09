// Each league's mark, shown between the two teams on a game's art (the NBA's
// silhouette, the WNBA's, the NFL shield, the NCAA's sport icons). ESPN's
// versions for dark backgrounds, as its scoreboards list them
// (leagues[0].logos, rel "dark").
const ESPN = 'https://a.espncdn.com';
const leaguePng = (name) => `${ESPN}/i/teamlogos/leagues/500-dark/${name}.png`;
// The NBA's and MLB's dark versions only come through ESPN's image combiner.
const combined = (name) => `${ESPN}/combiner/i?img=/i/teamlogos/leagues/500-dark/${name}.png&w=500&h=500&transparent=true`;
const ncaa = (sport) => `${ESPN}/redesign/assets/img/icons/NCAASports_${sport}.png`;
const soccer = (id) => `${ESPN}/i/leaguelogos/soccer/500-dark/${id}.png`;

const LEAGUE_LOGOS = {
  NFL: leaguePng('nfl'),
  'College Football': ncaa('Football'),
  NBA: combined('nba'),
  WNBA: leaguePng('wnba'),
  'College Basketball': ncaa('MensBasketball'),
  "Women's College Basketball": ncaa('WomensBasketball'),
  NHL: leaguePng('nhl'),
  MLB: combined('mlb'),
  MLS: soccer(19),
  'Premier League': soccer(23),
  LaLiga: soccer(15),
  'Champions League': soccer(2),
  'Serie A': soccer(12),
  Bundesliga: soccer(10),
  'Ligue 1': soccer(9),
  'Liga MX': soccer(22),
};

export function leagueLogo(league) {
  return LEAGUE_LOGOS[league] || null;
}

// College games between two teams of the same conference show the
// conference's mark instead of the NCAA's (SEC, ACC, Big Ten...). ESPN's
// conference logos, by the name its scoreboards give a conference game
// (competitions[0].groups.name). Dark-background versions where ESPN has one,
// filed under the conference's football id (FBS and FCS); the rest get a thin
// light edge in CSS. Every address checked 2026-11-09. CAA's dark version
// reads "CAA FOOTBALL", so it keeps its regular one.
const CONFERENCE_LOGOS = {
  'America East Conference': '500/america_east',
  'American Conference': '500-dark/151',
  'Atlantic 10 Conference': '500/atlantic_10',
  'Atlantic Coast Conference': '500-dark/1',
  'Atlantic Sun Conference': '500/atlantic_sun',
  'Big 12 Conference': '500-dark/4',
  'Big East Conference': '500/big_east',
  'Big Sky Conference': '500/big_sky',
  'Big South Conference': '500/big_south',
  'Big Ten Conference': '500-dark/5',
  'Big West Conference': '500/big_west',
  'Coastal Athletic Association': '500/caa',
  'Conference USA': '500/12',
  'Horizon League': '500/horizon',
  'Ivy League': '500/ivy',
  'Metro Conference': '500/metro',
  'Mid-American Conference': '500-dark/15',
  'Mid-Eastern Athletic Conference': '500/meac',
  'Missouri Valley Conference': '500/missouri_valley',
  'Mountain West Conference': '500-dark/17',
  'Northeast Conference': '500-dark/25',
  'Ohio Valley Conference': '500/ovc',
  'Pac-12 Conference': '500-dark/9',
  'Patriot League': '500-dark/27',
  'Southeastern Conference': '500-dark/8',
  'Southern Conference': '500/southern',
  'Southland Conference': '500-dark/30',
  'Southwestern Athletic Conference': '500-dark/31',
  'Summit League': '500/summit',
  'Sun Belt Conference': '500/37',
  'United Athletic Conference': '500/uac',
  'West Coast Conference': '500/west_coast',
};

export function conferenceLogo(name) {
  const path = CONFERENCE_LOGOS[name];
  return path ? `${ESPN}/i/teamlogos/ncaa_conf/${path}.png` : null;
}
