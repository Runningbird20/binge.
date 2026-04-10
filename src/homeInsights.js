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

function getMovieSeriesProgress(ratings) {
  const franchiseGroups = new Map();

  ratings
    .filter((rating) => rating.media_type === 'movie' && rating.title)
    .forEach((rating) => {
      const titleKey = normalizeTitle(rating.title);

      for (const key of getMovieFranchiseKeys(rating.title)) {
        if (!franchiseGroups.has(key)) {
          franchiseGroups.set(key, new Map());
        }

        franchiseGroups.get(key).set(titleKey, rating.title);
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

function getAdaptationPairs(ratings) {
  const booksByTitle = new Map();
  const moviesByTitle = new Map();

  ratings.forEach((rating) => {
    const normalizedTitle = normalizeTitle(rating.title);
    if (!normalizedTitle || normalizedTitle.length < 4) return;

    if (rating.media_type === 'book' && !booksByTitle.has(normalizedTitle)) {
      booksByTitle.set(normalizedTitle, rating.title);
    }

    if (rating.media_type === 'movie' && !moviesByTitle.has(normalizedTitle)) {
      moviesByTitle.set(normalizedTitle, rating.title);
    }
  });

  return [...booksByTitle.entries()]
    .filter(([normalizedTitle]) => moviesByTitle.has(normalizedTitle))
    .map(([normalizedTitle, title]) => title || moviesByTitle.get(normalizedTitle))
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

function getActiveTypeCount(ratings) {
  return new Set(ratings.map((rating) => rating.media_type).filter(Boolean)).size;
}

function buildBadges(ratings) {
  const totalLogged = ratings.length;
  const movieCount = ratings.filter((rating) => rating.media_type === 'movie').length;
  const activeTypeCount = getActiveTypeCount(ratings);
  const movieSeries = getMovieSeriesProgress(ratings);
  const adaptationPairs = getAdaptationPairs(ratings);
  const completedTypeLabels = Object.entries(TYPE_LABELS)
    .filter(([mediaType]) => ratings.some((rating) => rating.media_type === mediaType))
    .map(([, label]) => label);

  return [
    {
      id: 'first-log',
      kicker: 'START',
      name: 'First Log',
      description: 'Rate your first title to start your history.',
      earned: totalLogged >= 1,
      progressCurrent: Math.min(totalLogged, 1),
      progressTarget: 1,
      progressLabel: `${Math.min(totalLogged, 1)} / 1`,
      detail: totalLogged
        ? `Logged ${totalLogged} ${pluralize(totalLogged, 'title')} so far.`
        : 'No ratings yet.',
    },
    {
      id: 'film-centurion',
      kicker: 'MOVIES',
      name: '100 Films Logged',
      description: 'Log 100 movies across your rating history.',
      earned: movieCount >= 100,
      progressCurrent: Math.min(movieCount, 100),
      progressTarget: 100,
      progressLabel: `${Math.min(movieCount, 100)} / 100`,
      detail: `${movieCount} ${pluralize(movieCount, 'movie')} logged.`,
    },
    {
      id: 'trilogy-finisher',
      kicker: 'SERIES',
      name: 'Trilogy Finisher',
      description: 'Finish three films from the same franchise.',
      earned: movieSeries.count >= 3,
      progressCurrent: Math.min(movieSeries.count, 3),
      progressTarget: 3,
      progressLabel: `${Math.min(movieSeries.count, 3)} / 3`,
      detail: movieSeries.seriesName
        ? `Best progress: ${movieSeries.seriesName} (${Math.min(movieSeries.count, 3)} of 3).`
        : 'No film trilogy in progress yet.',
    },
    {
      id: 'book-and-film',
      kicker: 'ADAPTATION',
      name: 'Read The Book And Watched The Film',
      description: 'Log a book and its film adaptation with the same title.',
      earned: adaptationPairs.length >= 1,
      progressCurrent: Math.min(adaptationPairs.length, 1),
      progressTarget: 1,
      progressLabel: `${Math.min(adaptationPairs.length, 1)} / 1`,
      detail: adaptationPairs.length
        ? `Matched ${adaptationPairs[0]}${adaptationPairs.length > 1 ? ` and ${adaptationPairs.length - 1} more.` : '.'}`
        : 'Try logging a book and movie version of the same story.',
    },
    {
      id: 'cross-media',
      kicker: 'RANGE',
      name: 'Cross-Media Critic',
      description: 'Log a movie, TV show, and book.',
      earned: activeTypeCount >= 3,
      progressCurrent: Math.min(activeTypeCount, 3),
      progressTarget: 3,
      progressLabel: `${Math.min(activeTypeCount, 3)} / 3`,
      detail: completedTypeLabels.length
        ? `Completed: ${completedTypeLabels.join(', ')}.`
        : 'No media types logged yet.',
    },
  ].map((badge) => ({
    ...badge,
    progressPercent:
      badge.progressTarget > 0
        ? Math.round((badge.progressCurrent / badge.progressTarget) * 100)
        : 0,
  }));
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

export function buildHomeInsights(ratings = [], requestedYear) {
  const safeRatings = Array.isArray(ratings) ? ratings.filter(Boolean) : [];
  const fallbackYear = new Date().getFullYear();
  const availableYears = getAvailableYears(safeRatings, fallbackYear);
  const parsedRequestedYear = Number(requestedYear);
  const selectedYear = availableYears.includes(parsedRequestedYear)
    ? parsedRequestedYear
    : availableYears[0];
  const badges = buildBadges(safeRatings);

  return {
    badges,
    earnedBadgeCount: badges.filter((badge) => badge.earned).length,
    availableYears,
    selectedYear,
    recap: buildAnnualRecap(safeRatings, selectedYear),
  };
}
