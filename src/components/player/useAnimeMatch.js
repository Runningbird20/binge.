import { useEffect, useState } from 'react';
import { useSeasonEpisodes } from '../../hooks/useTitleDetails';
import { animeEpisode, animeTrackFor, loadAnimeMap, rememberAnimeTrack } from '../../utils/animeMap';

// Animated and not known to be non-Japanese (the catalog's language is often
// empty), so worth looking up in the anime map.
export function maybeAnime(item) {
  const genres = String(item?.genre || item?.genres || '').toLowerCase();
  const language = item?.original_language;
  return (genres.includes('animation') && (!language || language === 'ja')) || language === 'ja';
}

// Is this title anime the anime server has (utils/animeMap.js), and which
// AniList entry and episode is a TMDB episode; plus sub or dub, remembered per
// show (the profile's default until one is picked).
export default function useAnimeMatch({ item, mediaType, tmdbId, season }) {
  const candidate = Boolean(tmdbId && maybeAnime(item));
  const [map, setMap] = useState(null);
  useEffect(() => {
    if (!candidate) return undefined;
    let cancelled = false;
    loadAnimeMap().then((loaded) => { if (!cancelled) setMap(loaded); });
    return () => { cancelled = true; };
  }, [candidate]);

  const listed = Boolean(candidate && map && (mediaType === 'tv_show' ? map.tv?.[tmdbId] : map.movie?.[tmdbId]));
  // A season numbered from the series' start (One Piece's 22 is 1089-1155)
  // can use an AniList entry that runs the series' own numbers.
  const seasonList = useSeasonEpisodes(listed && mediaType === 'tv_show' && Number(season) > 1 ? tmdbId : null, season);
  const seriesNumbered = Boolean(seasonList?.length && seasonList[0].number > seasonList.length);
  const lookup = (s, e) => (listed
    ? animeEpisode(map, mediaType, tmdbId, s, e, { seriesNumbered: Number(s) === Number(season) && seriesNumbered })
    : null);

  const [track, setTrackState] = useState(() => animeTrackFor(item?.id));
  useEffect(() => { setTrackState(animeTrackFor(item?.id)); }, [item?.id]);
  const setTrack = (next) => {
    rememberAnimeTrack(item?.id, next);
    setTrackState(next);
  };

  return { isAnime: Boolean(lookup(season, 1) || (listed && mediaType !== 'tv_show')), lookup, track, setTrack };
}
