// Where to watch (title popup): TMDB's watch/providers (JustWatch's data).
// One logo per service: "Netflix" and "Netflix Standard with Ads", or
// "Paramount Plus Premium" and "Paramount+ Amazon Channel", are one service,
// shown with its plain logo, not a tier's.
import { tmdbGet } from './tmdb';
import { BRAND_MARKS } from './brandMarks';

// The viewer's country from the browser languages ("en-GB" → GB); US if none.
export function watchRegion(languages = (typeof navigator !== 'undefined' && (navigator.languages || [navigator.language])) || []) {
  for (const tag of languages) {
    const region = /^[a-z]{2,3}[-_]([A-Z]{2})\b/i.exec(String(tag || ''))?.[1];
    if (region) return region.toUpperCase();
  }
  return 'US';
}

// Tiers, ad plans and resold channels at the end of a provider's name.
// "Apple TV Store" (rent/buy) is the Apple TV app too: same logo.
const VARIANT = /\s+(standard|basic|premium plus|premium|essential|ultimate|kids|free with ads|with ads|ad[- ]supported|amazon channel|apple tv channel|roku premium channel|store)$/i;

const normalize = (name) => String(name || '').toLowerCase().replace(/\+/g, ' plus ').replace(/\s+/g, ' ').trim();

// Whole brands shown as one service, by decision: everything from YouTube
// (YouTube TV, YouTube Free, YouTube Premium) shows the regular YouTube logo.
const BRANDS = [{ test: /^youtube\b/, family: 'youtube', name: 'YouTube' }];

// The service a provider belongs to: "paramount plus" for "Paramount+ Amazon
// Channel" and "Paramount Plus Premium" alike.
export function providerFamily(name) {
  let family = normalize(name);
  for (let prev = ''; prev !== family;) { prev = family; family = family.replace(VARIANT, '').trim(); }
  return BRANDS.find((brand) => brand.test.test(family))?.family || family;
}

// The plain service name, as written ("Netflix Standard with Ads" → "Netflix").
export function serviceName(name) {
  const family = providerFamily(name);
  const brand = BRANDS.find((b) => b.family === family);
  if (brand) return brand.name;
  let out = String(name || '').trim();
  for (let prev = ''; prev !== out;) { prev = out; out = out.replace(VARIANT, '').trim(); }
  return BRAND_MARKS[family]?.name || out;
}

const isPlain = (name) => normalize(name) === providerFamily(name);

// Services never shown, by decision.
const HIDDEN = [/\bmx player\b/];
const isHidden = (name) => HIDDEN.some((re) => re.test(providerFamily(name)));

const STREAMING = ['flatrate', 'free', 'ads'];
const PAID = ['rent', 'buy'];
const KIND_LABEL = { flatrate: 'Stream', free: 'Free', ads: 'Free with ads', rent: 'Rent', buy: 'Buy' };

// → { link, how: 'stream' | 'rent', providers: [{ id, name, logo, family, plain, kinds }] }
// or null. Streaming options first; rent/buy only when nothing streams.
export function pickWatchProviders(watchData, region = watchRegion(), max = 6) {
  const country = watchData?.results?.[region];
  if (!country) return null;
  const collect = (kinds) => {
    const byFamily = new Map();
    kinds.forEach((kind) => (country[kind] || []).forEach((p) => {
      if (!p?.logo_path || isHidden(p.provider_name)) return;
      const family = providerFamily(p.provider_name);
      const plain = isPlain(p.provider_name);
      const existing = byFamily.get(family);
      if (existing) {
        if (!existing.kinds.includes(KIND_LABEL[kind])) existing.kinds.push(KIND_LABEL[kind]);
        existing.priority = Math.min(existing.priority, p.display_priority ?? 999);
        if (plain && !existing.plain) Object.assign(existing, { id: p.provider_id, logo: p.logo_path, plain: true });
        return;
      }
      byFamily.set(family, {
        id: p.provider_id,
        name: serviceName(p.provider_name),
        logo: p.logo_path,
        family,
        plain,
        kinds: [KIND_LABEL[kind]],
        priority: p.display_priority ?? 999,
      });
    }));
    return [...byFamily.values()].sort((a, b) => a.priority - b.priority).slice(0, max);
  };
  const streaming = collect(STREAMING);
  if (streaming.length) return { link: country.link || null, how: 'stream', providers: streaming };
  const paid = collect(PAID);
  if (paid.length) return { link: country.link || null, how: 'rent', providers: paid };
  return null;
}

// When a title only lists a variant ("Netflix Standard with Ads"), the plain
// service's logo comes from TMDB's provider list for the country (one cached
// request per country and type).
export async function withPlainLogos(watch, mediaType, region = watchRegion()) {
  if (!watch?.providers?.some((p) => !p.plain && !BRAND_MARKS[p.family])) return watch;
  // The title's own type first, then the other (plain YouTube is only listed
  // for movies, for instance). Both requests are cached.
  const kinds = mediaType === 'tv_show' ? ['tv', 'movie'] : ['movie', 'tv'];
  const lists = await Promise.all(kinds.map((kind) => tmdbGet(`/watch/providers/${kind}`, { watch_region: region }).catch(() => null)));
  const plainByFamily = new Map();
  lists.forEach((data) => (data?.results || []).forEach((p) => {
    const family = providerFamily(p.provider_name);
    if (p.logo_path && isPlain(p.provider_name) && !plainByFamily.has(family)) plainByFamily.set(family, p);
  }));
  return {
    ...watch,
    providers: watch.providers.map((p) => {
      if (p.plain || BRAND_MARKS[p.family]) return p;
      const plain = plainByFamily.get(p.family);
      return plain ? { ...p, id: plain.provider_id, logo: plain.logo_path, name: plain.provider_name, plain: true } : p;
    }),
  };
}
