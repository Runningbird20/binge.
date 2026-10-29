// The curated browse rows (Featured, genres, decades...) for movies, TV and
// books, built from the Neon catalog and cached for CURATED_CACHE_TTL.

const neonDb = require('../neonDb');

let cachedCuratedMovies = null;

let cachedCuratedMoviesTime = 0;

let cachedCuratedTv = null;

let cachedCuratedTvTime = 0;

let cachedCuratedBooks = null;

let cachedCuratedBooksTime = 0;

const CURATED_CACHE_TTL = 15 * 60 * 1000;

async function getCuratedMovieRowsNeon() {
  const now = Date.now();
  if (cachedCuratedMovies && now - cachedCuratedMoviesTime < CURATED_CACHE_TTL) {
    return cachedCuratedMovies;
  }

  const CURRENT_YEAR = new Date().getFullYear();
  const baseFilter = `poster_url IS NOT NULL AND source_key IS NOT NULL AND (year IS NULL OR year <= ${CURRENT_YEAR})`;

  const rowDefs = [
    { id: 'featured', title: 'Featured Picks', seeAll: '/movies?sort=relevance', query: `SELECT * FROM movies WHERE ${baseFilter} ORDER BY popularity DESC NULLS LAST LIMIT 30` },
    { id: 'upcoming', title: 'Upcoming Releases', seeAll: '/movies?sort=year-desc&upcoming=1', query: `SELECT * FROM movies WHERE poster_url IS NOT NULL AND source_key IS NOT NULL AND year > ${CURRENT_YEAR} ORDER BY year ASC, popularity DESC NULLS LAST LIMIT 30` },
    { id: 'trending', title: 'Trending Now', seeAll: '/movies?sort=year-desc', query: `SELECT * FROM movies WHERE ${baseFilter} AND year >= ${CURRENT_YEAR - 1} ORDER BY popularity DESC NULLS LAST LIMIT 30` },
    { id: 'top_rated', title: 'Top Rated', seeAll: '/movies?sort=rating-desc', query: `SELECT * FROM movies WHERE ${baseFilter} AND vote_average >= 7.5 ORDER BY vote_average DESC, popularity DESC NULLS LAST LIMIT 30` },
    { id: 'action', title: 'Action & Adventure', seeAll: '/movies?genre=Action', query: `SELECT * FROM movies WHERE ${baseFilter} AND genre ILIKE '%Action%' ORDER BY popularity DESC NULLS LAST LIMIT 30` },
    { id: 'comedy', title: 'Comedy', seeAll: '/movies?genre=Comedy', query: `SELECT * FROM movies WHERE ${baseFilter} AND genre ILIKE '%Comedy%' ORDER BY popularity DESC NULLS LAST LIMIT 30` },
    { id: 'horror', title: 'Horror', seeAll: '/movies?genre=Horror', query: `SELECT * FROM movies WHERE ${baseFilter} AND genre ILIKE '%Horror%' ORDER BY popularity DESC NULLS LAST LIMIT 30` },
    { id: 'scifi', title: 'Sci-Fi', seeAll: '/movies?genre=Science+Fiction', query: `SELECT * FROM movies WHERE ${baseFilter} AND (genre ILIKE '%Sci-Fi%' OR genre ILIKE '%Science Fiction%') ORDER BY popularity DESC NULLS LAST LIMIT 30` },
    { id: 'drama', title: 'Drama', seeAll: '/movies?genre=Drama', query: `SELECT * FROM movies WHERE ${baseFilter} AND genre ILIKE '%Drama%' ORDER BY popularity DESC NULLS LAST LIMIT 30` },
    { id: 'thriller', title: 'Thriller & Mystery', seeAll: '/movies?genre=Thriller', query: `SELECT * FROM movies WHERE ${baseFilter} AND (genre ILIKE '%Thriller%' OR genre ILIKE '%Mystery%') ORDER BY popularity DESC NULLS LAST LIMIT 30` },
    { id: 'family', title: 'Family & Animation', seeAll: '/movies?genre=Family', query: `SELECT * FROM movies WHERE ${baseFilter} AND (genre ILIKE '%Family%' OR genre ILIKE '%Animation%') ORDER BY popularity DESC NULLS LAST LIMIT 30` },
    { id: 'romance', title: 'Romance', seeAll: '/movies?genre=Romance', query: `SELECT * FROM movies WHERE ${baseFilter} AND genre ILIKE '%Romance%' ORDER BY popularity DESC NULLS LAST LIMIT 30` },
  ];

  const results = await Promise.all(
    rowDefs.map(async (def) => {
      try {
        const res = await neonDb.query(def.query);
        return {
          id: def.id,
          title: def.title,
          seeAll: def.seeAll,
          items: res.rows.map((r) => ({ ...r, id: Number(r.id) })),
        };
      } catch (err) {
        return { id: def.id, title: def.title, seeAll: def.seeAll, items: [] };
      }
    })
  );

  const filtered = results.filter((r) => r.items.length > 0);
  if (filtered.length > 0) {
    cachedCuratedMovies = filtered;
    cachedCuratedMoviesTime = now;
  }
  return filtered;
}

async function getCuratedTvRowsNeon() {
  const now = Date.now();
  if (cachedCuratedTv && now - cachedCuratedTvTime < CURATED_CACHE_TTL) {
    return cachedCuratedTv;
  }

  const CURRENT_YEAR = new Date().getFullYear();
  const baseFilter = `poster_url IS NOT NULL AND source_key IS NOT NULL AND (year IS NULL OR year <= ${CURRENT_YEAR})`;

  const rowDefs = [
    { id: 'featured', title: 'Featured Series', seeAll: '/tv-shows?sort=relevance', query: `SELECT * FROM tv_shows WHERE ${baseFilter} ORDER BY popularity DESC NULLS LAST LIMIT 30` },
    { id: 'upcoming', title: 'Coming Soon', seeAll: '/tv-shows?sort=year-desc&upcoming=1', query: `SELECT * FROM tv_shows WHERE poster_url IS NOT NULL AND source_key IS NOT NULL AND year > ${CURRENT_YEAR} ORDER BY year ASC, popularity DESC NULLS LAST LIMIT 30` },
    { id: 'trending', title: 'Trending Now', seeAll: '/tv-shows?sort=year-desc', query: `SELECT * FROM tv_shows WHERE ${baseFilter} AND year >= ${CURRENT_YEAR - 1} ORDER BY popularity DESC NULLS LAST LIMIT 30` },
    { id: 'top_rated', title: 'Top Rated', seeAll: '/tv-shows', query: `SELECT * FROM tv_shows WHERE ${baseFilter} AND vote_average >= 7.5 ORDER BY vote_average DESC, popularity DESC NULLS LAST LIMIT 30` },
    { id: 'drama', title: 'Drama', seeAll: '/tv-shows?genre=Drama', query: `SELECT * FROM tv_shows WHERE ${baseFilter} AND genre ILIKE '%Drama%' ORDER BY popularity DESC NULLS LAST LIMIT 30` },
    { id: 'comedy', title: 'Comedy & Sitcoms', seeAll: '/tv-shows?genre=Comedy', query: `SELECT * FROM tv_shows WHERE ${baseFilter} AND genre ILIKE '%Comedy%' ORDER BY popularity DESC NULLS LAST LIMIT 30` },
    { id: 'crime', title: 'Crime & Mystery', seeAll: '/tv-shows?genre=Crime', query: `SELECT * FROM tv_shows WHERE ${baseFilter} AND (genre ILIKE '%Crime%' OR genre ILIKE '%Mystery%') ORDER BY popularity DESC NULLS LAST LIMIT 30` },
    { id: 'scifi', title: 'Sci-Fi & Fantasy', seeAll: '/tv-shows?genre=Sci-Fi', query: `SELECT * FROM tv_shows WHERE ${baseFilter} AND (genre ILIKE '%Sci-Fi%' OR genre ILIKE '%Science Fiction%' OR genre ILIKE '%Fantasy%') ORDER BY popularity DESC NULLS LAST LIMIT 30` },
    { id: 'anime', title: 'Anime', seeAll: '/tv-shows?genre=Anime', query: `SELECT * FROM tv_shows WHERE ${baseFilter} AND (genre ILIKE '%Anime%' OR genre ILIKE '%Animation%') ORDER BY popularity DESC NULLS LAST LIMIT 30` },
    { id: 'action', title: 'Action & Adventure', seeAll: '/tv-shows?genre=Action', query: `SELECT * FROM tv_shows WHERE ${baseFilter} AND genre ILIKE '%Action%' ORDER BY popularity DESC NULLS LAST LIMIT 30` },
  ];

  const results = await Promise.all(
    rowDefs.map(async (def) => {
      try {
        const res = await neonDb.query(def.query);
        return {
          id: def.id,
          title: def.title,
          seeAll: def.seeAll,
          items: res.rows.map((r) => ({ ...r, id: Number(r.id) })),
        };
      } catch (err) {
        return { id: def.id, title: def.title, seeAll: def.seeAll, items: [] };
      }
    })
  );

  const filtered = results.filter((r) => r.items.length > 0);
  if (filtered.length > 0) {
    cachedCuratedTv = filtered;
    cachedCuratedTvTime = now;
  }
  return filtered;
}

async function getCuratedBookRowsNeon() {
  const now = Date.now();
  if (cachedCuratedBooks && now - cachedCuratedBooksTime < CURATED_CACHE_TTL) {
    return cachedCuratedBooks;
  }

  const baseFilter = 'cover_url IS NOT NULL AND source_key IS NOT NULL';

  const rowDefs = [
    { id: 'fiction', title: 'Popular Fiction', seeAll: '/books?genre=Fiction', query: `SELECT * FROM books WHERE ${baseFilter} AND (genre ILIKE '%Fiction%' OR genre = 'General Fiction') ORDER BY year DESC NULLS LAST LIMIT 30` },
    { id: 'scifi', title: 'Science Fiction', seeAll: '/books?genre=Science+Fiction', query: `SELECT * FROM books WHERE ${baseFilter} AND genre ILIKE '%Science Fiction%' ORDER BY year DESC NULLS LAST LIMIT 30` },
    { id: 'fantasy', title: 'Fantasy', seeAll: '/books?genre=Fantasy', query: `SELECT * FROM books WHERE ${baseFilter} AND genre ILIKE '%Fantasy%' ORDER BY year DESC NULLS LAST LIMIT 30` },
    { id: 'mystery', title: 'Mystery & Thriller', seeAll: '/books?genre=Mystery', query: `SELECT * FROM books WHERE ${baseFilter} AND (genre ILIKE '%Mystery%' OR genre ILIKE '%Thriller%' OR genre ILIKE '%Crime%') ORDER BY year DESC NULLS LAST LIMIT 30` },
    { id: 'romance', title: 'Romance', seeAll: '/books?genre=Romance', query: `SELECT * FROM books WHERE ${baseFilter} AND genre ILIKE '%Romance%' ORDER BY year DESC NULLS LAST LIMIT 30` },
    { id: 'history', title: 'History', seeAll: '/books?genre=History', query: `SELECT * FROM books WHERE ${baseFilter} AND genre ILIKE '%History%' ORDER BY year DESC NULLS LAST LIMIT 30` },
    { id: 'classics', title: 'Classic Literature', seeAll: '/books?genre=Classic', query: `SELECT * FROM books WHERE ${baseFilter} AND (genre ILIKE '%Classic%' OR (year < 1960 AND year > 1800)) ORDER BY year DESC NULLS LAST LIMIT 30` },
  ];

  const results = await Promise.all(
    rowDefs.map(async (def) => {
      try {
        const res = await neonDb.query(def.query);
        return {
          id: def.id,
          title: def.title,
          seeAll: def.seeAll,
          items: res.rows.map((r) => ({ ...r, id: Number(r.id) })),
        };
      } catch (err) {
        return { id: def.id, title: def.title, seeAll: def.seeAll, items: [] };
      }
    })
  );

  const filtered = results.filter((r) => r.items.length > 0);
  if (filtered.length > 0) {
    cachedCuratedBooks = filtered;
    cachedCuratedBooksTime = now;
  }
  return filtered;
}

module.exports = { getCuratedMovieRowsNeon, getCuratedTvRowsNeon, getCuratedBookRowsNeon };
