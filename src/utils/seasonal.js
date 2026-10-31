// The seasonal row on the Movies and TV pages: what's relevant this time of
// year (horror in October, Christmas after Thanksgiving, romance before
// Valentine's Day…), picked from today's date so the row and its title change
// on their own. The Apple TV (Data/Seasonal.swift) and Fire TV
// (data/Seasonal.kt) apps carry the same calendar — keep the three in sync.
//
// Queries are TMDB discover params. Keyword ids were checked against TMDB and
// every query fills a row from the catalog (2026-10-31).

const KW = {
  halloween: '3335', hauntedHouse: '3358', zombie: '12377', vampire: '3133', werewolf: '12564', witch: '616', ghost: '162846',
  christmas: '207317', santa: '1991', thanksgiving: '4543', newYearsEve: '613', snow: '10794', winter: '1442',
  romance: '9840', civilRights: '4098', civilRightsMovement: '270891', africanAmerican: '256015', blackHistory: '190675',
  sports: '6075', basketball: '6496', americanFootball: '579', baseball: '1480', easter: '9921', easterBunny: '9923',
  roadTrip: '7312', springBreak: '158054', motherDaughter: '240315', fatherSon: '240119', fatherDaughter: '240303',
  lgbt: '158718', pride: '156501', fourthOfJuly: '159743', independenceDay: '235503', shark: '15097',
  summer: '13088', summerVacation: '14714', beach: '966', highSchool: '6270', backToSchool: '187282', college: '3616',
};
const any = (...ids) => ids.join('|');

const SPOOKY_TV = { with_keywords: any(KW.halloween, KW.hauntedHouse, KW.zombie, KW.vampire, KW.werewolf, KW.witch), without_genres: '10762,10766', 'vote_count.gte': '100' };
const SPOOKY_KIDS = { with_keywords: any(KW.halloween, KW.hauntedHouse, KW.witch, KW.ghost) };
const CHRISTMAS = { with_keywords: any(KW.christmas, KW.santa) };
const ROMANCE_TV = { with_keywords: KW.romance, with_genres: '18|35', 'vote_count.gte': '100' };
const SUMMER_TV = { with_keywords: any(KW.summer, KW.summerVacation, KW.beach), 'vote_count.gte': '20' };

// Dates are local calendar days (no time of day).
const day = (year, month, date) => new Date(year, month - 1, date);
const addDays = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// The nth `weekday` (0 = Sunday) of a month; n = -1 is the last one.
export function nthWeekday(year, month, weekday, n) {
  if (n > 0) {
    const first = day(year, month, 1);
    return day(year, month, 1 + ((weekday - first.getDay() + 7) % 7) + (n - 1) * 7);
  }
  const last = day(year, month + 1, 0);
  return day(year, month, last.getDate() - ((last.getDay() - weekday + 7) % 7));
}

// Western Easter Sunday (anonymous Gregorian algorithm).
export function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  return day(year, month, ((h + l - 7 * m + 114) % 31) + 1);
}

const thanksgiving = (year) => nthWeekday(year, 11, 4, 4);
const memorialDay = (year) => nthWeekday(year, 5, 1, -1);

// In priority order: the first season whose window holds today (and has a
// query for the page's type) wins, so short holidays sit above the longer
// seasons around them. Every day of the year is covered for both types.
// `window(year)` → [first day, last day], inclusive. `title(date, type)`.
export const SEASONS = [
  {
    id: 'halloween-night',
    window: (y) => [day(y, 10, 25), day(y, 10, 31)],
    title: (date) => (date.getDate() === 31 ? 'Happy Halloween' : 'Halloween Week'),
    subtitle: 'Scary picks for the big night',
    movie: { with_keywords: KW.halloween, 'vote_count.gte': '100' },
    tv: SPOOKY_TV,
    kids: SPOOKY_KIDS,
    fallback: { genre: 'Horror' },
  },
  {
    id: 'spooky-season',
    window: (y) => [day(y, 10, 1), day(y, 10, 24)],
    title: () => 'Spooky Season',
    subtitle: 'Horror and haunts for October',
    movie: { with_genres: '27', 'vote_count.gte': '500' },
    tv: SPOOKY_TV,
    kids: SPOOKY_KIDS,
    fallback: { genre: 'Horror' },
  },
  {
    id: 'thanksgiving',
    window: (y) => [day(y, 11, 1), thanksgiving(y)],
    title: (date, type) => {
      if (sameDay(date, thanksgiving(date.getFullYear()))) return 'Happy Thanksgiving';
      if (type === 'tv_show') return 'Comfort TV for Thanksgiving';
      return addDays(thanksgiving(date.getFullYear()), -6) <= date ? 'Thanksgiving Week' : 'Thanksgiving Movies';
    },
    subtitle: 'Something everyone at the table can watch',
    movie: { with_keywords: KW.thanksgiving, 'vote_count.gte': '30' },
    tv: { with_genres: '35', without_genres: '16,10762,10764', 'vote_count.gte': '500' },
    kids: { with_keywords: KW.thanksgiving },
    fallback: { genre: 'Family' },
  },
  {
    id: 'christmas',
    window: (y) => [addDays(thanksgiving(y), 1), day(y, 12, 25)],
    title: (date, type) => {
      if (date.getMonth() === 10) return 'The Holidays Start Now';
      if (date.getDate() >= 24) return 'Merry Christmas';
      if (date.getDate() >= 18) return 'Countdown to Christmas';
      return type === 'tv_show' ? 'Christmas Shows' : 'Christmas Movies';
    },
    subtitle: 'Holiday favorites, old and new',
    movie: { ...CHRISTMAS, without_genres: '27', 'vote_count.gte': '100' },
    tv: { ...CHRISTMAS, 'vote_count.gte': '10' },
    kids: CHRISTMAS,
    fallback: { genre: 'Family' },
  },
  {
    id: 'new-year',
    window: (y) => [day(y, 12, 26), day(y + 1, 1, 1)],
    title: (date, type) => {
      if (date.getMonth() === 0) return 'Happy New Year';
      return type === 'tv_show' ? 'Binge a Limited Series' : 'Ring In the New Year';
    },
    subtitle: 'For the days between the holidays',
    movie: { with_keywords: KW.newYearsEve, 'vote_count.gte': '50' },
    tv: { with_type: '2', sort_by: 'vote_average.desc', 'vote_count.gte': '500' },
    fallback: null,
  },
  {
    id: 'valentines',
    window: (y) => [day(y, 2, 1), day(y, 2, 14)],
    title: (date) => (date.getDate() >= 11 ? "Date Night for Valentine's" : "Valentine's Day Romance"),
    subtitle: 'Romance and rom-coms',
    movie: { with_genres: '10749', 'vote_count.gte': '500' },
    tv: ROMANCE_TV,
    fallback: { genre: 'Romance' },
  },
  {
    id: 'black-history-month',
    window: (y) => [day(y, 2, 15), day(y, 3, 0)],
    title: () => 'Celebrating Black History Month',
    subtitle: 'Stories of Black history and life',
    movie: { with_keywords: any(KW.civilRights, KW.civilRightsMovement, KW.africanAmerican, KW.blackHistory), 'vote_count.gte': '200' },
    tv: { with_keywords: any(KW.civilRights, KW.civilRightsMovement, KW.africanAmerican, KW.blackHistory), 'vote_count.gte': '10' },
    fallback: null,
  },
  {
    id: 'winter',
    window: (y) => [day(y, 1, 2), day(y, 1, 31)],
    title: () => 'Snowed In',
    subtitle: 'Winter stories for cold nights',
    movie: { with_keywords: any(KW.snow, KW.winter), 'vote_count.gte': '300' },
    tv: { with_keywords: any(KW.snow, KW.winter), 'vote_count.gte': '20' },
    kids: { with_keywords: any(KW.snow, KW.winter) },
    fallback: null,
  },
  {
    id: 'easter',
    window: (y) => [addDays(easterSunday(y), -7), easterSunday(y)],
    title: (date) => (sameDay(date, easterSunday(date.getFullYear())) ? 'Happy Easter' : 'Easter Favorites'),
    subtitle: 'For the long weekend',
    movie: { with_keywords: any(KW.easter, KW.easterBunny), 'vote_count.gte': '20' },
    kids: { with_keywords: any(KW.easter, KW.easterBunny) },
    fallback: { genre: 'Family' },
  },
  {
    id: 'may-the-4th',
    window: (y) => [day(y, 4, 28), day(y, 5, 4)],
    title: () => 'May the 4th Be With You',
    subtitle: 'From a galaxy far, far away',
    movie: { with_companies: '1', 'vote_count.gte': '500' }, // Lucasfilm
    tv: { with_companies: '1', 'vote_count.gte': '20' },
    fallback: null,
  },
  {
    id: 'mothers-day',
    window: (y) => [addDays(nthWeekday(y, 5, 0, 2), -6), nthWeekday(y, 5, 0, 2)],
    title: () => "Mother's Day Movies",
    subtitle: 'Watch one with Mom',
    movie: { with_keywords: KW.motherDaughter, without_genres: '27,28,53,878', 'vote_count.gte': '300' },
    fallback: null,
  },
  {
    id: 'fathers-day',
    window: (y) => [addDays(nthWeekday(y, 6, 0, 3), -6), nthWeekday(y, 6, 0, 3)],
    title: () => "Father's Day Movies",
    subtitle: 'Watch one with Dad',
    movie: { with_keywords: any(KW.fatherSon, KW.fatherDaughter), without_genres: '27,53', 'vote_count.gte': '500' },
    fallback: null,
  },
  {
    id: 'fourth-of-july',
    window: (y) => [day(y, 6, 28), day(y, 7, 4)],
    title: () => 'Fourth of July Movies',
    subtitle: 'Fireworks optional',
    movie: { with_keywords: any(KW.fourthOfJuly, KW.independenceDay), 'vote_count.gte': '50' },
    fallback: null,
  },
  {
    id: 'shark-week',
    window: (y) => [day(y, 7, 20), day(y, 7, 31)],
    title: () => 'Shark Week',
    subtitle: 'Something in the water',
    movie: { with_keywords: KW.shark, 'vote_count.gte': '100' },
    tv: { with_keywords: KW.shark, 'vote_count.gte': '1' },
    kids: { with_keywords: KW.shark },
    fallback: null,
  },
  {
    id: 'pride',
    window: (y) => [day(y, 6, 1), day(y, 6, 30)],
    title: () => 'Pride Month',
    subtitle: 'LGBTQ+ stories',
    movie: { with_keywords: any(KW.lgbt, KW.pride), 'vote_count.gte': '500' },
    tv: { with_keywords: KW.lgbt, 'vote_count.gte': '20' },
    fallback: null,
  },
  {
    id: 'march-madness',
    window: (y) => [day(y, 3, 1), day(y, 4, 7)],
    title: () => 'March Madness',
    subtitle: 'Sports stories for tournament season',
    movie: { with_keywords: any(KW.sports, KW.basketball, KW.americanFootball, KW.baseball), 'vote_count.gte': '300' },
    tv: { with_keywords: any(KW.sports, KW.basketball, KW.americanFootball, KW.baseball), 'vote_count.gte': '20' },
    kids: { with_keywords: any(KW.sports, KW.basketball, KW.americanFootball, KW.baseball) },
    fallback: null,
  },
  {
    id: 'spring',
    window: (y) => [day(y, 4, 8), addDays(memorialDay(y), -1)],
    title: (date, type) => (type === 'tv_show' ? 'Feel-Good Comedies for Spring' : 'Spring Break Road Trips'),
    subtitle: 'Get out of the house (on screen)',
    movie: { with_keywords: any(KW.roadTrip, KW.springBreak), 'vote_count.gte': '500' },
    tv: { with_genres: '35', without_genres: '16,10762,10764', 'vote_count.gte': '300' },
    kids: { with_keywords: KW.roadTrip },
    fallback: { genre: 'Comedy' },
  },
  {
    id: 'summer',
    window: (y) => [memorialDay(y), day(y, 8, 14)],
    title: (date, type) => (type === 'tv_show' ? 'Summer Binge' : 'Summer Blockbusters'),
    subtitle: 'Big, loud and made for summer',
    movie: { with_genres: '28|12', 'vote_count.gte': '3000' },
    tv: SUMMER_TV,
    kids: { with_keywords: any(KW.summer, KW.summerVacation, KW.beach) },
    fallback: { genre: 'Action' },
  },
  {
    id: 'back-to-school',
    window: (y) => [day(y, 8, 15), day(y, 9, 7)],
    title: () => 'Back to School',
    subtitle: 'Hallways, dorms and first days',
    movie: { with_keywords: any(KW.highSchool, KW.backToSchool, KW.college), without_genres: '27', 'vote_count.gte': '500' },
    tv: { with_keywords: any(KW.highSchool, KW.college), 'vote_count.gte': '50' },
    kids: { with_keywords: any(KW.highSchool, KW.backToSchool) },
    fallback: null,
  },
  {
    id: 'fall',
    window: (y) => [day(y, 9, 8), day(y, 9, 30)],
    title: () => 'Cozy Fall Mysteries',
    subtitle: 'Whodunits for longer nights',
    movie: { with_genres: '9648', 'vote_count.gte': '1000' },
    tv: { with_genres: '9648', 'vote_count.gte': '200' },
    fallback: { genre: 'Mystery' },
  },
];

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

function inWindow(season, date) {
  // A window can cross New Year (Dec 26 – Jan 1), so last year's counts too.
  return [date.getFullYear(), date.getFullYear() - 1].some((year) => {
    const [first, last] = season.window(year);
    return first <= date && date <= last;
  });
}

// The season for a page on `date`: { id, title, subtitle, params, fallback }.
// A season without a query for this type (or for kids) gives way to the
// next one that holds today, e.g. Easter week on the TV page shows the
// surrounding March Madness / spring row.
export function seasonFor(mediaType, { date = new Date(), kids = false } = {}) {
  const today = startOfDay(date);
  const key = mediaType === 'tv_show' ? 'tv' : 'movie';
  for (const season of SEASONS) {
    if (!inWindow(season, today)) continue;
    const params = kids ? season.kids : season[key];
    if (!params) continue;
    return { id: season.id, title: season.title(today, mediaType), subtitle: season.subtitle, params, fallback: season.fallback };
  }
  return null;
}
