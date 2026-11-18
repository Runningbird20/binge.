import { useEffect, useState } from 'react';
import { loadRowItems, rowsFor } from '../../utils/browseRows';
import { computeProgressBadge, resumeUrl } from '../../utils/continueWatching';
import { tmdbGet, tmdbIdFromItem, tmdbImage, tmdbKind } from '../../utils/tmdb';
import { loadWatchedKeys, withoutWatched } from '../../utils/watchedTitles';
import { asTitle } from './asTitle';

// Continue Watching has no backdrop art of its own — fetch TMDB's so the
// hero gets a proper wide image instead of a stretched poster.
async function withBackdrop(item) {
  const tmdbId = tmdbIdFromItem(item);
  if (!tmdbId || item.media_type === 'book') return item;
  const details = await tmdbGet(`/${tmdbKind(item.media_type)}/${tmdbId}`);
  return details?.backdrop_path
    ? { ...item, backdrop_url: tmdbImage(details.backdrop_path, 'w1280'), overview: details.overview || item.overview }
    : item;
}

// Home's spotlight: resume what you were watching first, then your top picks —
// or trending for a brand-new profile. null while it's still being built.
export default function useHomeSpotlight(visibleContinueWatching, personal, kidsSafe) {
  const [heroItems, setHeroItems] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function buildHero() {
      const watchedKeys = await loadWatchedKeys();
      const resume = visibleContinueWatching
        .filter((item) => item.media_type !== 'book')
        .slice(0, 1)
        .map((item) => ({ ...asTitle(item), _playUrl: resumeUrl(item), _playLabel: 'Resume', _reason: computeProgressBadge(item) ? `Continue ${computeProgressBadge(item)}` : 'Continue where you left off' }));
      // A mix that changes every visit: a few of your picks (one per
      // language/genre, chosen at random from the top dozen) and what's
      // trending this week, interleaved.
      const shuffled = (list) => list.map((item) => ({ item, r: Math.random() })).sort((a, b) => a.r - b.r).map(({ item }) => item);
      const seen = new Set();
      const picks = [];
      for (const item of shuffled(withoutWatched(personal?.topPicks || [], watchedKeys).slice(0, 12))) {
        const flavour = `${item.original_language || ''}|${String(item.genre || '').split(',')[0].trim()}`;
        if (seen.has(flavour)) continue;
        seen.add(flavour);
        picks.push(item);
        if (picks.length >= 3) break;
      }
      const trending = personal ? (await Promise.all([
        loadRowItems(rowsFor('tv_show', { kidsSafe })[0], 'tv_show', { kidsSafe }).catch(() => []),
        loadRowItems(rowsFor('movie', { kidsSafe })[0], 'movie', { kidsSafe }).catch(() => []),
      ])).flatMap((list) => shuffled(withoutWatched(list, watchedKeys).slice(0, 8)).slice(0, picks.length ? 1 : 3)) : [];
      const mixed = [];
      const queues = [picks, shuffled(trending)];
      while (queues.some((queue) => queue.length)) queues.forEach((queue) => { if (queue.length) mixed.push(queue.shift()); });
      const withArt = await Promise.all(resume.map(withBackdrop));
      const keys = new Set(withArt.map((item) => `${item.media_type}:${item.id}`));
      if (!cancelled) setHeroItems([...withArt, ...mixed.filter((item) => !keys.has(`${item.media_type}:${item.id}`))]);
    }
    buildHero();
    return () => { cancelled = true; };
  }, [visibleContinueWatching, personal, kidsSafe]);

  return heroItems;
}
