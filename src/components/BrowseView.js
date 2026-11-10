import { useEffect, useMemo, useState } from 'react';
import { readKept, writeKept } from '../utils/keptCache';
import { Link } from 'react-router-dom';
import { SquaresFour } from '@phosphor-icons/react';
import BrowseHero from './BrowseHero';
import TitleRow from './TitleRow';
import { useAuth } from '../contexts/AuthContext';
import { maturityRestriction } from '../utils/kidsMode';
import { buildPersonalizedRows } from '../utils/personalization';
import { loadRowItems, orderRowsForTaste, rowsFor, sortForTaste } from '../utils/browseRows';
import { useWatchedKeys, withoutWatched } from '../utils/watchedTitles';

const TYPE_COPY = {
  movie: { noun: 'Movies', path: '/movies' },
  tv_show: { noun: 'Series', path: '/tv-shows' },
};

// The default Movies / TV landing: spotlight + personalized rows + curated
// rows ordered by the profile's taste. "Browse all" switches the page to
// the filterable grid (CatalogView) for people who do want to dig.
// Everything here is a recommendation, so titles the profile has watched are
// left out (the grid and search still list them).
export default function BrowseView({ mediaType, refreshKey = 0 }) {
  const { activeProfile, profilesLoading } = useAuth();
  const kidsSafe = maturityRestriction(activeProfile);
  const copy = TYPE_COPY[mediaType];
  const [personal, setPersonal] = useState(null);
  const [trending, setTrending] = useState(null);

  useEffect(() => {
    if (profilesLoading) return undefined;
    let cancelled = false;
    // The last visit's rows paint at once (keptCache.js), then fresh ones.
    const keepKey = `personal:${mediaType}:${activeProfile?.id || ''}:${kidsSafe || 'all'}`;
    setPersonal(readKept(keepKey) || null);
    buildPersonalizedRows({ mediaTypes: [mediaType], kidsSafe, becauseLimit: 3 })
      .then((result) => {
        if (cancelled) return;
        setPersonal(result);
        writeKept(keepKey, result);
      })
      .catch(() => { if (!cancelled) setPersonal({ hasHistory: false, topPicks: [], becauseYouWatched: [], taste: {} }); });
    return () => { cancelled = true; };
  }, [mediaType, kidsSafe, profilesLoading, refreshKey, activeProfile?.id]);

  const definitions = useMemo(
    () => orderRowsForTaste(rowsFor(mediaType, { kidsSafe }), personal?.taste),
    [mediaType, kidsSafe, personal?.taste]
  );

  // The hero needs the first headline row up front (it's above the fold),
  // so load it eagerly and hand the same items to its row.
  const headline = definitions[0];
  useEffect(() => {
    let cancelled = false;
    const keepKey = `row:${mediaType}:${headline.id}:${kidsSafe || 'all'}`;
    setTrending(readKept(keepKey) || null);
    loadRowItems(headline, mediaType, { kidsSafe })
      .then((items) => {
        if (cancelled) return;
        setTrending(items);
        if (items?.length) writeKept(keepKey, items);
      })
      .catch(() => { if (!cancelled) setTrending([]); });
    return () => { cancelled = true; };
  }, [headline, mediaType, kidsSafe, refreshKey]);

  // Trending can paint while the more expensive personalized rows finish.
  const watched = useWatchedKeys();
  const heroItems = useMemo(() => {
    const pool = personal?.hasHistory && personal.topPicks.length >= 3 ? personal.topPicks : trending;
    return pool && watched ? withoutWatched(pool, watched) : null;
  }, [personal, trending, watched]);

  const loaders = useMemo(() => {
    const map = new Map();
    definitions.slice(1).forEach((definition) => {
      const load = () => loadRowItems(definition, mediaType, { kidsSafe });
      map.set(definition.id, definition.seasonal ? () => load().then((items) => sortForTaste(items, personal?.taste)) : load);
    });
    return map;
    // refreshKey recreates the loaders so pull-to-refresh refetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definitions, mediaType, kidsSafe, refreshKey, personal?.taste]);

  return (
    <div className="st-browse">
      <BrowseHero
        items={heroItems}
        kicker={personal?.hasHistory ? `Picked for ${activeProfile?.name || 'you'}` : `Trending ${copy.noun}`}
      />

      <div className="st-browse-toolbar">
        <Link className="genre-chip st-pill-link" to={`${copy.path}?view=all`}>
          <SquaresFour size={18} weight="bold" /> Browse all {copy.noun.toLowerCase()}
        </Link>
      </div>

      <div className="st-rows">
        {personal?.hasHistory && personal.topPicks.length > 0 && (
          <TitleRow
            title={`Top Picks for ${activeProfile?.name || 'You'}`}
            subtitle="Based on what you watch and how you rate it"
            items={personal.topPicks}
            eager
            hideWatched
          />
        )}

        <TitleRow
          key={`${headline.id}-${refreshKey}`}
          title={headline.title}
          items={trending || undefined}
          limit={headline.ranked ? 10 : undefined}
          loading={!trending}
          ranked={headline.ranked}
          eager
          hideWatched
        />

        {personal?.becauseYouWatched?.map((row) => (
          <TitleRow key={row.id} title={row.title} items={row.items} hideWatched />
        ))}

        {definitions.slice(1).map((definition) => (
          <TitleRow
            // The seasonal row re-sorts (from the row cache) once taste arrives.
            key={`${definition.id}-${refreshKey}${definition.seasonal && personal?.taste ? '-taste' : ''}`}
            title={definition.title}
            subtitle={definition.subtitle}
            load={loaders.get(definition.id)}
            keepKey={definition.seasonal ? undefined : `row:${mediaType}:${definition.id}:${kidsSafe || 'all'}`}
            minItems={definition.comingSoon ? 1 : 5}
            hideWatched
          />
        ))}
      </div>
    </div>
  );
}
