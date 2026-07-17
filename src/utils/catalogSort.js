// Shared "sort by" options for the Movies/TV Shows/Books browse pages.
// 'featured' keeps each page's existing random-window discovery mode
// (unchanged); every other option switches to a real sequential, sorted
// paginated fetch — see sortModeToQuery().
export const SORT_OPTIONS = [
  { value: 'featured', label: 'Featured' },
  { value: 'newest', label: 'Newest Release' },
  { value: 'oldest', label: 'Oldest Release' },
  { value: 'az', label: 'Title A–Z' },
  { value: 'za', label: 'Title Z–A' },
];

export function sortModeToQuery(sortMode) {
  switch (sortMode) {
    case 'newest':
      // Surface upcoming/announced titles too, not just already-released ones.
      return { sortOrder: 'year-desc', includeUpcoming: true };
    case 'oldest':
      return { sortOrder: 'year-asc', includeUpcoming: false };
    case 'az':
      return { sortOrder: 'title-asc', includeUpcoming: false };
    case 'za':
      return { sortOrder: 'title-desc', includeUpcoming: false };
    default:
      return { sortOrder: 'title-asc', includeUpcoming: false };
  }
}
