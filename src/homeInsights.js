export const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'at',
  'by',
  'for',
  'from',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
]);

const NON_SERIES_TOKENS = new Set([
  'after',
  'again',
  'before',
  'city',
  'death',
  'dream',
  'final',
  'first',
  'game',
  'girl',
  'good',
  'great',
  'history',
  'home',
  'house',
  'last',
  'life',
  'light',
  'little',
  'love',
  'man',
  'murder',
  'night',
  'return',
  'road',
  'secret',
  'story',
  'stranger',
  'woman',
  'world',
]);

const TYPE_LABELS = {
  movie: 'Movies',
  tv_show: 'TV Shows',
  book: 'Books',
};

const BADGE_TIERS = [
  { key: 'bronze', label: 'Bronze' },
  { key: 'silver', label: 'Silver' },
  { key: 'gold', label: 'Gold' },
  { key: 'platinum', label: 'Platinum' },
];

function pluralize(count, singular, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

function titleCase(value) {
  return String(value || '')
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function normalizeTitle(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getSignificantTokens(title) {
  const uniqueTokens = [];

  for (const token of normalizeTitle(title).split(' ')) {
    if (!token || token.length < 3 || STOP_WORDS.has(token) || uniqueTokens.includes(token)) {
      continue;
    }
    uniqueTokens.push(token);
  }

  return uniqueTokens;
}

function getMovieFranchiseKeys(title) {
  const normalizedTitle = normalizeTitle(title);
  const titleBeforeSubtitle = normalizedTitle.split(':')[0].trim() || normalizedTitle;
  const baseTokens = getSignificantTokens(titleBeforeSubtitle);
  const allTokens = getSignificantTokens(normalizedTitle);
  const keys = new Set();

  if (baseTokens.length >= 2) {
    keys.add(baseTokens.slice(0, 2).join(' '));
  }

  if (baseTokens.length >= 1) {
    const firstToken = baseTokens[0];
    if (firstToken.length >= 4 && !NON_SERIES_TOKENS.has(firstToken)) {
      keys.add(firstToken);
    }
  }

  if (/\bof\b/.test(normalizedTitle) && allTokens.length >= 2) {
    const lastToken = allTokens[allTokens.length - 1];
    if (lastToken.length >= 4 && !NON_SERIES_TOKENS.has(lastToken)) {
      keys.add(lastToken);
    }
  }

  return [...keys];
}

function isCompletedLibraryItem(item) {
  if (!item || !item.media_type) return false;
  if (item.media_type === 'book') return item.status === 'read';
  return item.status === 'watched';
}

function getCompletedLibraryItems(watchlistItems = []) {
  return watchlistItems.filter((item) => isCompletedLibraryItem(item));
}

function getCompletedTypeCounts(completedItems) {
  const counts = {
    movie: 0,
    tv_show: 0,
    book: 0,
  };

  completedItems.forEach((item) => {
    if (Object.prototype.hasOwnProperty.call(counts, item.media_type)) {
      counts[item.media_type] += 1;
    }
  });

  return counts;
}

function getMovieSeriesProgress(completedItems) {
  const franchiseGroups = new Map();

  completedItems
    .filter((item) => item.media_type === 'movie' && item.title)
    .forEach((item) => {
      const titleKey = normalizeTitle(item.title);

      for (const key of getMovieFranchiseKeys(item.title)) {
        if (!franchiseGroups.has(key)) {
          franchiseGroups.set(key, new Map());
        }

        franchiseGroups.get(key).set(titleKey, item.title);
      }
    });

  const bestGroup = [...franchiseGroups.entries()]
    .filter(([, titles]) => titles.size > 0)
    .sort((left, right) => {
      const sizeDifference = right[1].size - left[1].size;
      if (sizeDifference !== 0) return sizeDifference;
      return right[0].length - left[0].length;
    })[0];

  if (!bestGroup) {
    return {
      count: 0,
      seriesName: null,
    };
  }

  return {
    count: bestGroup[1].size,
    seriesName: titleCase(bestGroup[0]),
  };
}

function getAdaptationPairs(completedItems) {
  const booksByTitle = new Map();
  const moviesByTitle = new Map();

  completedItems.forEach((item) => {
    const normalizedTitle = normalizeTitle(item.title);
    if (!normalizedTitle || normalizedTitle.length < 4) return;

    if (item.media_type === 'book' && !booksByTitle.has(normalizedTitle)) {
      booksByTitle.set(normalizedTitle, item.title);
    }

    if (item.media_type === 'movie' && !moviesByTitle.has(normalizedTitle)) {
      moviesByTitle.set(normalizedTitle, item.title);
    }
  });

  return [...booksByTitle.entries()]
    .filter(([normalizedTitle]) => moviesByTitle.has(normalizedTitle))
    .map(([, title]) => title)
    .sort((left, right) => left.localeCompare(right));
}

function parseLoggedAt(value) {
  if (typeof value !== 'string' || value.length < 7) return null;

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }

  return { year, month };
}

function splitGenres(value) {
  return String(value || '')
    .split(',')
    .map((genre) => genre.trim())
    .filter(Boolean);
}

function getAvailableYears(ratings, fallbackYear) {
  const years = Array.from(
    new Set(
      ratings
        .map((rating) => parseLoggedAt(rating.created_at)?.year)
        .filter((year) => Number.isInteger(year))
    )
  ).sort((left, right) => right - left);

  return years.length ? years : [fallbackYear];
}

function getTierState(value, thresholds) {
  const earnedTierIndex = thresholds.reduce(
    (currentIndex, threshold, index) => (value >= threshold ? index : currentIndex),
    -1
  );
  const completed = earnedTierIndex >= 0;
  const maxed = earnedTierIndex === thresholds.length - 1;
  const currentTier = completed ? BADGE_TIERS[earnedTierIndex] : null;
  const displayTier = currentTier || BADGE_TIERS[0];
  const nextTier = maxed ? null : BADGE_TIERS[earnedTierIndex + 1];
  const progressTarget = maxed ? thresholds[thresholds.length - 1] : thresholds[earnedTierIndex + 1];
  const progressCurrent = Math.min(value, progressTarget);
  const progressPercent = progressTarget > 0
    ? Math.round((progressCurrent / progressTarget) * 100)
    : 0;

  return {
    completed,
    maxed,
    currentTier,
    displayTier,
    nextTier,
    progressCurrent,
    progressTarget,
    progressPercent,
    progressLabel: `${progressCurrent} / ${progressTarget}`,
    progressCaption: maxed ? `${displayTier.label} complete` : `Toward ${nextTier.label}`,
    tierSummary: currentTier ? `${currentTier.label} unlocked` : `Working toward ${displayTier.label}`,
    statusLabel: completed ? 'Completed' : 'In Progress',
  };
}

function createTieredBadge({
  id,
  kicker,
  name,
  description,
  value,
  thresholds,
  detail,
}) {
  const tierState = getTierState(value, thresholds);

  return {
    id,
    kicker,
    name,
    description,
    detail,
    value,
    thresholds,
    ...tierState,
    earned: tierState.completed,
  };
}

function buildBadges(watchlistItems) {
  const completedItems = getCompletedLibraryItems(watchlistItems);
  const completedTypeCounts = getCompletedTypeCounts(completedItems);
  const movieSeries = getMovieSeriesProgress(completedItems);
  const adaptationPairs = getAdaptationPairs(completedItems);
  const crossMediaSetCount = Math.min(
    completedTypeCounts.movie,
    completedTypeCounts.tv_show,
    completedTypeCounts.book
  );
  const completedTypeLabels = Object.entries(TYPE_LABELS)
    .filter(([mediaType]) => completedTypeCounts[mediaType] > 0)
    .map(([, label]) => label);

  return [
    createTieredBadge({
      id: 'completion-collector',
      kicker: 'COMPLETE',
      name: 'Completion Collector',
      description: 'Finish titles from your Watched and Read lists.',
      value: completedItems.length,
      thresholds: [5, 15, 30, 60],
      detail: completedItems.length
        ? `Completed ${completedItems.length} ${pluralize(completedItems.length, 'title')} across your finished library.`
        : 'Mark titles as Watched or Read to begin unlocking tiers.',
    }),
    createTieredBadge({
      id: 'film-centurion',
      kicker: 'MOVIES',
      name: 'Film Finisher',
      description: 'Turn watched movies into higher-tier movie badges.',
      value: completedTypeCounts.movie,
      thresholds: [100, 150, 200, 300],
      detail: `${completedTypeCounts.movie} watched ${pluralize(completedTypeCounts.movie, 'movie')}. Bronze starts at 100.`,
    }),
    createTieredBadge({
      id: 'trilogy-finisher',
      kicker: 'SERIES',
      name: 'Trilogy Finisher',
      description: 'Complete films from the same franchise on your Watched list.',
      value: movieSeries.count,
      thresholds: [3, 4, 5, 6],
      detail: movieSeries.seriesName
        ? `Best series progress: ${movieSeries.seriesName} (${movieSeries.count} watched ${pluralize(movieSeries.count, 'film')}).`
        : 'No watched franchise streak yet.',
    }),
    createTieredBadge({
      id: 'book-and-film',
      kicker: 'ADAPTATION',
      name: 'Read The Book And Watched The Film',
      description: 'Complete matching book and movie titles to climb each metal tier.',
      value: adaptationPairs.length,
      thresholds: [1, 2, 3, 5],
      detail: adaptationPairs.length
        ? `Matched ${adaptationPairs[0]}${adaptationPairs.length > 1 ? ` and ${adaptationPairs.length - 1} more.` : '.'}`
        : 'Complete a book and its movie adaptation with the same title.',
    }),
    createTieredBadge({
      id: 'cross-media',
      kicker: 'RANGE',
      name: 'Cross-Media Critic',
      description: 'Finish movies, shows, and books in balanced sets.',
      value: crossMediaSetCount,
      thresholds: [1, 3, 5, 10],
      detail: completedTypeLabels.length
        ? `${completedTypeLabels.join(', ')} completed. Sets available: ${crossMediaSetCount}.`
        : 'Complete at least one movie, one show, and one book for Bronze.',
    }),
  ];
}

function buildAnnualRecap(ratings, year) {
  const filteredRatings = ratings.filter((rating) => parseLoggedAt(rating.created_at)?.year === year);
  const monthlyCounts = MONTH_LABELS.map((label, index) => ({
    label,
    month: index + 1,
    count: 0,
  }));
  const countsByType = {
    movie: 0,
    tv_show: 0,
    book: 0,
  };
  const genreCounts = new Map();

  filteredRatings.forEach((rating) => {
    const loggedAt = parseLoggedAt(rating.created_at);
    if (!loggedAt) return;

    monthlyCounts[loggedAt.month - 1].count += 1;

    if (Object.prototype.hasOwnProperty.call(countsByType, rating.media_type)) {
      countsByType[rating.media_type] += 1;
    }

    splitGenres(rating.genre).forEach((genre) => {
      genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1);
    });
  });

  const maxMonthlyCount = Math.max(...monthlyCounts.map((month) => month.count), 0);
  const busiestMonth = monthlyCounts
    .filter((month) => month.count > 0)
    .sort((left, right) => right.count - left.count || left.month - right.month)[0] || null;

  return {
    year,
    totalLogged: filteredRatings.length,
    countsByType,
    activeMonths: monthlyCounts.filter((month) => month.count > 0).length,
    busiestMonth,
    monthly: monthlyCounts.map((month) => ({
      ...month,
      percent: maxMonthlyCount > 0 ? Math.round((month.count / maxMonthlyCount) * 100) : 0,
    })),
    topGenres: [...genreCounts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 4)
      .map(([label, count]) => ({ label, count })),
  };
}

export function buildRecapNarrative(recap) {
  if (!recap || recap.totalLogged === 0) {
    return `No titles logged in ${recap?.year || 'this year'} yet. Rate something to unlock your recap.`;
  }

  const parts = [
    `You logged ${recap.totalLogged} ${pluralize(recap.totalLogged, 'title')} in ${recap.year}.`,
    `You showed up in ${recap.activeMonths} ${pluralize(recap.activeMonths, 'month')}.`,
  ];

  if (recap.busiestMonth) {
    parts.push(
      `${recap.busiestMonth.label} was your busiest month with ${recap.busiestMonth.count} ${pluralize(recap.busiestMonth.count, 'log')}.`
    );
  }

  return parts.join(' ');
}

export function buildHomeInsights(ratings = [], watchlistItems = [], requestedYear) {
  const safeRatings = Array.isArray(ratings) ? ratings.filter(Boolean) : [];
  const safeWatchlistItems = Array.isArray(watchlistItems) ? watchlistItems.filter(Boolean) : [];
  const fallbackYear = new Date().getFullYear();
  const availableYears = getAvailableYears(safeRatings, fallbackYear);
  const parsedRequestedYear = Number(requestedYear);
  const selectedYear = availableYears.includes(parsedRequestedYear)
    ? parsedRequestedYear
    : availableYears[0];
  const badges = buildBadges(safeWatchlistItems);

  return {
    badges,
    earnedBadgeCount: badges.filter((badge) => badge.completed).length,
    availableYears,
    selectedYear,
    recap: buildAnnualRecap(safeRatings, selectedYear),
  };
}
