// Kids profiles are an allowlist, not a blocklist: most catalog rows have no
// age_rating at all (scraped from sources that don't always carry one), so
// excluding only explicitly-mature ratings would let the whole unrated bulk
// of the catalog through unfiltered. Safer to only show titles explicitly
// rated for kids/general audiences.
export const KIDS_SAFE_RATINGS = ['G', 'PG', 'TV-G', 'TV-Y', 'TV-Y7', 'TV-PG'];
