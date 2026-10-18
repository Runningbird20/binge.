import { useEffect, useState } from 'react';
import { getEmbeddedId } from '../utils/embedPlayability';
import { tmdbGet, tmdbImage, tmdbKind } from '../utils/tmdb';

function usCertification(data, mediaType) {
  if (mediaType === 'tv_show') {
    const ratings = data.content_ratings?.results || [];
    return (ratings.find((r) => r.iso_3166_1 === 'US') || ratings[0])?.rating || null;
  }
  const releases = data.release_dates?.results || [];
  const us = releases.find((r) => r.iso_3166_1 === 'US');
  return us?.release_dates?.find((r) => r.certification)?.certification || null;
}

function pickLogo(images) {
  const logos = images?.logos || [];
  const english = logos.filter((logo) => logo.iso_639_1 === 'en');
  const best = (english.length ? english : logos).sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0))[0];
  return best ? tmdbImage(best.file_path, 'w500') : null;
}

function pickTrailer(videos) {
  const list = (videos?.results || []).filter((video) => video.site === 'YouTube');
  const trailer = list.find((video) => video.type === 'Trailer' && video.official)
    || list.find((video) => video.type === 'Trailer')
    || list.find((video) => video.type === 'Teaser');
  return trailer?.key || null;
}

// TMDB enrichment for the detail modal (one cached request): high-res
// backdrop, title logo art, cast, age rating, runtime/seasons and trailer.
// Returns null fields when TMDB isn't reachable; the modal falls back to the
// catalog row.
export default function useTitleDetails(item, mediaType) {
  const [details, setDetails] = useState(null);
  const embedded = getEmbeddedId(item);
  const tmdbId = embedded?.kind === 'tmdb' ? embedded.value : null;

  useEffect(() => {
    setDetails(null);
    if (!tmdbId || (mediaType !== 'movie' && mediaType !== 'tv_show')) return undefined;
    let cancelled = false;
    const extra = mediaType === 'tv_show' ? 'content_ratings' : 'release_dates';
    tmdbGet(`/${tmdbKind(mediaType)}/${tmdbId}`, {
      append_to_response: `credits,images,videos,${extra}`,
      include_image_language: 'en,null',
    }).then((data) => {
      if (cancelled || !data) return;
      const seasons = (data.seasons || []).filter((season) => season.season_number > 0 && season.episode_count > 0);
      setDetails({
        tmdbId: Number(tmdbId),
        backdrop: data.backdrop_path ? tmdbImage(data.backdrop_path, 'original') : null,
        logo: pickLogo(data.images),
        tagline: data.tagline || '',
        overview: data.overview || '',
        certification: usCertification(data, mediaType),
        runtime: data.runtime || (data.episode_run_time || [])[0] || null,
        seasons,
        status: data.status || '',
        genres: (data.genres || []).map((genre) => genre.name),
        originalLanguage: data.original_language || null,
        voteAverage: Number(data.vote_average) || 0,
        voteCount: Number(data.vote_count) || 0,
        cast: (data.credits?.cast || []).slice(0, 8).map((person) => person.name),
        creators: mediaType === 'tv_show'
          ? (data.created_by || []).map((person) => person.name)
          : (data.credits?.crew || []).filter((person) => person.job === 'Director').map((person) => person.name),
        trailerKey: pickTrailer(data.videos),
        networks: (data.networks || data.production_companies || []).slice(0, 2).map((entry) => entry.name),
      });
    });
    return () => { cancelled = true; };
  }, [tmdbId, mediaType]);

  return details;
}

// One season's episodes (stills, titles, runtimes) for the episode list.
export function useSeasonEpisodes(tmdbId, seasonNumber) {
  const [episodes, setEpisodes] = useState(null);

  useEffect(() => {
    setEpisodes(null);
    if (!tmdbId || !seasonNumber) return undefined;
    let cancelled = false;
    tmdbGet(`/tv/${tmdbId}/season/${seasonNumber}`).then((data) => {
      if (cancelled) return;
      setEpisodes((data?.episodes || []).map((episode) => ({
        number: episode.episode_number,
        title: episode.name,
        overview: episode.overview,
        runtime: episode.runtime,
        airDate: episode.air_date,
        still: episode.still_path ? tmdbImage(episode.still_path, 'w300') : null,
      })));
    });
    return () => { cancelled = true; };
  }, [tmdbId, seasonNumber]);

  return episodes;
}
