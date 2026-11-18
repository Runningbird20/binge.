import { FilmSlate, Television } from '@phosphor-icons/react';
import {
  fetchMovieById,
  fetchMovieCatalogSegment,
  fetchTvShowById,
  fetchTvShowCatalogSegment,
} from '../../utils/catalogQueries';
import { MOVIE_GENRE_GROUPS, TV_GENRE_GROUPS } from '../../utils/genreGroups';

// What differs between the Movies and Series pages (pages/CatalogPage.js) and
// their filterable grid (CatalogView). The data functions are called through
// the module each time, so tests can spy on them.
export const CATALOGS = {
  movie: {
    title: 'Movies', path: '/movies', cacheName: 'movies',
    one: 'movie', many: 'movies', label: 'Movie', Icon: FilmSlate,
    fetchById: (id) => fetchMovieById(id), fetchSegment: (query) => fetchMovieCatalogSegment(query),
    genreGroups: MOVIE_GENRE_GROUPS,
  },
  tv_show: {
    title: 'Series', path: '/tv-shows', cacheName: 'tv_show',
    one: 'series', many: 'series', label: 'Series', Icon: Television,
    fetchById: (id) => fetchTvShowById(id), fetchSegment: (query) => fetchTvShowCatalogSegment(query),
    genreGroups: TV_GENRE_GROUPS,
  },
};
