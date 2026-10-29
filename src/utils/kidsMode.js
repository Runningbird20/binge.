// Kids profiles are an allowlist, not a blocklist: most catalog rows have no
// age_rating at all (scraped from sources that don't always carry one), so
// excluding only explicitly-mature ratings would let the whole unrated bulk
// of the catalog through unfiltered. Safer to only show titles explicitly
// rated for kids/general audiences.
export const KIDS_SAFE_RATINGS = ['G', 'PG', 'TV-G', 'TV-Y', 'TV-Y7', 'TV-PG'];

// Maturity levels a profile can have (Edit Profile). `is_kids` stays the
// master switch the TV apps read (any restricted level sets it, and they
// apply the Kids list); account_profiles.settings.maturity picks the level.
export const MATURITY_LEVELS = [
  { value: 'toddler', label: 'Toddler', note: 'Only titles rated G or TV-Y.', ratings: ['G', 'TV-Y'] },
  { value: 'kids', label: 'Kids', note: 'Titles rated G, PG, TV-Y, TV-Y7, TV-G or TV-PG.', ratings: KIDS_SAFE_RATINGS },
  { value: 'teens', label: 'Teens', note: 'Everything up to PG-13 and TV-14.', ratings: [...KIDS_SAFE_RATINGS, 'PG-13', 'TV-14'] },
  { value: 'all', label: 'No restrictions', note: 'Every title, including R, NC-17 and TV-MA.', ratings: null },
];

// 'toddler' | 'kids' | 'teens' | 'all'
export function profileMaturity(profile) {
  if (!profile?.is_kids) return 'all';
  const level = profile.settings?.maturity;
  return ['toddler', 'kids', 'teens'].includes(level) ? level : 'kids';
}

// What the catalog filters take as `kidsSafe`: false, or the level.
export function maturityRestriction(profile) {
  const level = profileMaturity(profile);
  return level === 'all' ? false : level;
}

// Allowed age ratings for a `kidsSafe` value (`true` means Kids).
export function ratingsFor(kidsSafe) {
  if (!kidsSafe) return null;
  return MATURITY_LEVELS.find((level) => level.value === kidsSafe)?.ratings || KIDS_SAFE_RATINGS;
}

// Toddler and Kids get the kids-only rows; Teens browse the normal rows,
// filtered by rating.
export function isChildLevel(kidsSafe) {
  return Boolean(kidsSafe) && kidsSafe !== 'teens';
}
