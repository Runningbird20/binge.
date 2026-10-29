import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';

// A show's real season count and each season's episode count, from TMDB via
// the API. Episode counts load per season as it's opened.
export default function useEpisodeGuide({ item, isTV, tmdbId, season, resetKey }) {
  const [metadataWarning, setMetadataWarning] = useState('');
  const [seasonEpisodeCounts, setSeasonEpisodeCounts] = useState({});
  const [realSeasonCount, setRealSeasonCount] = useState(null);
  const itemSeasonCount = Number.isFinite(Number(item?.seasons)) ? Number(item.seasons) : null;
  const totalSeasons = Math.max(1, realSeasonCount ?? itemSeasonCount ?? 1);

  useEffect(() => {
    setSeasonEpisodeCounts({});
    setRealSeasonCount(null);
    setMetadataWarning('');
  }, [resetKey]);

  useEffect(() => {
    if (!isTV || !tmdbId) return undefined;

    let cancelled = false;

    async function fetchShowDetails() {
      try {
        const showData = await api.get(`/media/tmdb-show?tmdbId=${tmdbId}`);
        if (cancelled) return;
        if (showData?.numberOfSeasons) {
          setRealSeasonCount(showData.numberOfSeasons);
        }
      } catch (err) {
        if (cancelled) return;
        if (err.message?.includes('TMDB_API_KEY')) {
          setMetadataWarning('Add TMDB_API_KEY to your .env for accurate episode counts.');
        }
      }
    }

    fetchShowDetails();

    return () => {
      cancelled = true;
    };
  }, [isTV, tmdbId]);

  const fetchSeasonEpisodes = useCallback(async (seasonNumber) => {
    if (!tmdbId || !isTV || seasonEpisodeCounts[seasonNumber] !== undefined) return;

    try {
      const data = await api.get(`/media/tmdb-season?tmdbId=${tmdbId}&season=${seasonNumber}`);
      const nextCount = Math.max(1, Number(data?.episodeCount) || 1);
      setSeasonEpisodeCounts((previous) => ({ ...previous, [seasonNumber]: nextCount }));
    } catch (err) {
      if (err.message?.includes('TMDB_API_KEY')) {
        setMetadataWarning('Add TMDB_API_KEY to your .env for accurate episode counts.');
      }
      // Don't fall back to a hardcoded number — leave as null so UI shows "Loading..."
      // Only set a fallback if we have NO other info at all
      setSeasonEpisodeCounts((previous) => ({
        ...previous,
        [seasonNumber]: previous[seasonNumber] ?? null,
      }));
    }
  }, [tmdbId, isTV, seasonEpisodeCounts]);

  // Episodes are fetched per season when it's selected: fetching every
  // season at once ran into rate limits and slowed loading.
  useEffect(() => {
    if (tmdbId && isTV) {
      fetchSeasonEpisodes(season);
    }
  }, [fetchSeasonEpisodes, isTV, season, tmdbId]);

  return { seasonEpisodeCounts, totalSeasons, metadataWarning };
}
