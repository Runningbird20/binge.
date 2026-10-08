import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { SquaresFour } from '@phosphor-icons/react';
import BrowseHero from './BrowseHero';
import TitleRow from './TitleRow';
import { useAuth } from '../contexts/AuthContext';
import { buildPersonalizedRows } from '../utils/personalization';
import { loadRowItems, orderRowsForTaste, rowsFor } from '../utils/browseRows';

const TYPE_COPY = {
  movie: { noun: 'Movies', path: '/movies' },
  tv_show: { noun: 'Series', path: '/tv-shows' },
};

// The default Movies / TV landing: spotlight + personalized rows + curated
// rows ordered by the profile's taste. "Browse all" switches the page to
// the filterable grid (CatalogView) for people who do want to dig.
export default function BrowseView({ mediaType, refreshKey = 0 }) {
  const { activeProfile, profilesLoading } = useAuth();
  const kidsSafe = Boolean(activeProfile?.is_kids);
  const copy = TYPE_COPY[mediaType];
  const [personal, setPersonal] = useState(null);
  const [trending, setTrending] = useState(null);

  useEffect(() => {
    if (profilesLoading) return undefined;
    let cancelled = false;
    setPersonal(null);
    buildPersonalizedRows({ mediaTypes: [mediaType], kidsSafe, becauseLimit: 3 })
      .then((result) => { if (!cancelled) setPersonal(result); })
      .catch(() => { if (!cancelled) setPersonal({ hasHistory: false, topPicks: [], becauseYouWatched: [], taste: {} }); });
    return () => { cancelled = true; };
  }, [mediaType, kidsSafe, profilesLoading, refreshKey]);

  const definitions = useMemo(
    () => orderRowsForTaste(rowsFor(mediaType, { kidsSafe }), personal?.taste),
    [mediaType, kidsSafe, personal?.taste]
  );

  // The hero needs the first headline row up front (it's above the fold),
  // so load it eagerly and hand the same items to its row.
  const headline = definitions[0];
  useEffect(() => {
    let cancelled = false;
    setTrending(null);
    loadRowItems(headline, mediaType, { kidsSafe })
      .then((items) => { if (!cancelled) setTrending(items); })
      .catch(() => { if (!cancelled) setTrending([]); });
    return () => { cancelled = true; };
  }, [headline, mediaType, kidsSafe, refreshKey]);

  const heroItems = personal?.hasHistory && personal.topPicks.length >= 3 ? personal.topPicks : trending || [];

  const loaders = useMemo(() => {
    const map = new Map();
    definitions.slice(1).forEach((definition) => {
      map.set(definition.id, () => loadRowItems(definition, mediaType, { kidsSafe }));
    });
    return map;
    // refreshKey recreates the loaders so pull-to-refresh refetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definitions, mediaType, kidsSafe, refreshKey]);

  return (
    <div className="st-browse">
      <BrowseHero
        items={heroItems}
        kicker={personal?.hasHistory ? `Picked for ${activeProfile?.name || 'you'}` : `Trending ${copy.noun}`}
      />

      <div className="st-browse-toolbar">
        <Link className="st-btn st-btn--ghost" to={`${copy.path}?view=all`}>
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
          />
        )}

        <TitleRow
          key={`${headline.id}-${refreshKey}`}
          title={headline.title}
          items={trending ? trending.slice(0, headline.ranked ? 10 : undefined) : undefined}
          loading={!trending}
          ranked={headline.ranked}
          eager
        />

        {personal?.becauseYouWatched?.map((row) => (
          <TitleRow key={row.id} title={row.title} items={row.items} />
        ))}

        {definitions.slice(1).map((definition) => (
          <TitleRow
            key={`${definition.id}-${refreshKey}`}
            title={definition.title}
            subtitle={definition.subtitle}
            load={loaders.get(definition.id)}
            minItems={definition.comingSoon ? 1 : 5}
          />
        ))}
      </div>
    </div>
  );
}
