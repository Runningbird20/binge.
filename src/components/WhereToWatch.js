import { useEffect, useState } from 'react';
import { tmdbImage } from '../utils/tmdb';
import { displaySize, logoWithoutTile } from '../utils/providerLogos';
import { BRAND_MARKS } from '../utils/brandMarks';
import { withPlainLogos } from '../utils/watchProviders';

// One service's logo with its app-tile background removed (just Netflix's red
// N on the popup's own background). The original tile shows only if the
// background couldn't be removed.
function ProviderLogo({ provider, label }) {
  const mark = BRAND_MARKS[provider.family];
  const tile = mark ? null : tmdbImage(provider.logo, 'w154');
  const [logo, setLogo] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!tile) return undefined;
    let cancelled = false;
    setLogo(null);
    setFailed(false);
    logoWithoutTile(tile).then((keyed) => {
      if (cancelled) return;
      if (keyed) setLogo(keyed);
      else setFailed(true);
    });
    return () => { cancelled = true; };
  }, [tile]);

  if (mark) {
    const size = displaySize(mark.metrics);
    return (
      <svg className="td-watch-logo" viewBox={mark.viewBox} role="img" aria-label={label} style={size}>
        <title>{label}</title>
        <path fill={mark.color} d={mark.path} />
      </svg>
    );
  }
  // crossOrigin so this load never leaves an unreadable copy in the cache.
  if (failed) return <img className="td-watch-logo td-watch-logo--tile" src={tile} alt={label} title={label} crossOrigin="anonymous" />;
  if (!logo) return <span className="td-watch-logo td-watch-logo--pending" aria-hidden="true" />;
  return <img className="td-watch-logo" src={logo.src} alt={label} title={label} style={displaySize(logo)} />;
}

// A row of the services a title streams on (or rents on, if it streams
// nowhere), under the title's info line. Data: TMDB watch/providers, which is
// JustWatch's.
export default function WhereToWatch({ watch, mediaType }) {
  const [resolved, setResolved] = useState(watch);

  useEffect(() => {
    let cancelled = false;
    setResolved(watch);
    if (watch) withPlainLogos(watch, mediaType).then((next) => { if (!cancelled) setResolved(next); });
    return () => { cancelled = true; };
  }, [watch, mediaType]);

  if (!resolved?.providers?.length) return null;
  const verb = resolved.how === 'rent' ? 'Rent or buy' : 'Watch';
  return (
    <div className="td-watch" role="list" aria-label={`Where to watch: ${resolved.providers.map((p) => p.name).join(', ')}`} title="Where to watch · data from JustWatch">
      {resolved.providers.map((provider) => (
        <span key={provider.family} role="listitem" className="td-watch-item">
          <ProviderLogo provider={provider} label={`${verb} on ${provider.name} (${provider.kinds.join(', ').toLowerCase()})`} />
        </span>
      ))}
    </div>
  );
}
