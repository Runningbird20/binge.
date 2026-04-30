// Shown immediately on page load; upgraded in background if API returns more channels.
// All use Pluto TV embed URLs — no YouTube (YouTube blocks 3rd-party embedding).
export const FALLBACK_CHANNELS = [
  { id: 'cbs-news-24-7',  name: 'CBS News 24/7',      category: 'News',         thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/cbs-news-24-7',                ytEmbedId: null, source: 'pluto' },
  { id: 'abc-news-live',  name: 'ABC News Live',       category: 'News',         thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/abc-news-live',                ytEmbedId: null, source: 'pluto' },
  { id: 'nbc-news-now',   name: 'NBC News Now',        category: 'News',         thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/nbc-news-now',                 ytEmbedId: null, source: 'pluto' },
  { id: 'bloomberg-tv',   name: 'Bloomberg TV',        category: 'News',         thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/bloomberg-television',          ytEmbedId: null, source: 'pluto' },
  { id: 'al-jazeera',     name: 'Al Jazeera English',  category: 'News',         thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/al-jazeera-english',            ytEmbedId: null, source: 'pluto' },
  { id: 'sky-news',       name: 'Sky News',            category: 'News',         thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/sky-news',                      ytEmbedId: null, source: 'pluto' },
  { id: 'nasa-tv',        name: 'NASA TV',             category: 'Documentary',  thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/nasa-tv',                       ytEmbedId: null, source: 'pluto' },
  { id: 'pluto-action',   name: 'Action Movies',       category: 'Movies',       thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/action-movies-pluto-tv',        ytEmbedId: null, source: 'pluto' },
  { id: 'pluto-comedy',   name: 'Comedy Central',      category: 'Comedy',       thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/comedy-central-pluto-tv',       ytEmbedId: null, source: 'pluto' },
  { id: 'pluto-drama',    name: 'Drama Queens',        category: 'Drama',        thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/drama-queens',                  ytEmbedId: null, source: 'pluto' },
  { id: 'pluto-thriller', name: 'Thrillers',           category: 'Movies',       thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/thrillers-pluto-tv',            ytEmbedId: null, source: 'pluto' },
  { id: 'pluto-horror',   name: 'Horror 24/7',         category: 'Horror',       thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/horror-24-7',                   ytEmbedId: null, source: 'pluto' },
  { id: 'pluto-anime',    name: 'Anime All Day',       category: 'Anime',        thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/anime-all-day',                 ytEmbedId: null, source: 'pluto' },
  { id: 'pluto-sports',   name: 'Sports Illustrated',  category: 'Sports',       thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/sports-illustrated-tv',         ytEmbedId: null, source: 'pluto' },
  { id: 'pluto-kids',     name: 'Kids Zone',           category: 'Kids',         thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/kid-zone',                      ytEmbedId: null, source: 'pluto' },
  { id: 'pluto-crime',    name: 'True Crime',          category: 'Documentary',  thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/true-crime-network',             ytEmbedId: null, source: 'pluto' },
  { id: 'pluto-classic',  name: 'Classic TV',          category: 'Entertainment',thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/classic-tv',                    ytEmbedId: null, source: 'pluto' },
  { id: 'pluto-music',    name: 'MTV Classic',         category: 'Music',        thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/mtv-classic',                   ytEmbedId: null, source: 'pluto' },
];

export async function fetchClientLiveTvChannels() {
  // 1. Try server route — short timeout so we don't block the browser fallback on cold starts
  try {
    const res = await fetch('/api/livetv/channels', {
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const data = await res.json();
      const channels = Array.isArray(data) ? data : (data.channels || []);
      if (channels.length > 0) return channels;
    }
  } catch { /* fall through */ }

  // 2. Direct browser call to Pluto API (CORS allowed; request originates from user's browser)
  try {
    return await fetchPlutoChannelsDirect();
  } catch { /* fall through */ }

  // 3. Hardcoded fallback (all Pluto embed URLs, no YouTube)
  return FALLBACK_CHANNELS;
}

async function fetchPlutoChannelsDirect() {
  const now  = new Date();
  const stop = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const fmt  = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const url  = `https://api.pluto.tv/v2/channels?start=${fmt(now)}&stop=${fmt(stop)}&appName=web&appVersion=na&clientID=na&clientModelNumber=na&serverSideAds=false&constraints=&marketingRegion=US`;

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Pluto TV ${response.status}`);

  const payload  = await response.json();
  const channels = Array.isArray(payload) ? payload : payload.channels || [];

  const mapped = channels
    .filter(c => c.isStitched !== false && c.visibility !== 'private')
    .map(c => ({
      id:           c._id || c.id,
      name:         c.name,
      slug:         c.slug,
      category:     c.category || c.genre || 'Entertainment',
      thumbnail:    c.thumbnail?.path || c.logo?.path || c.colorLogoPNG?.path || null,
      featuredImage:c.featuredImage?.path || null,
      summary:      c.summary || c.description || '',
      nowPlaying:   c.timelines?.[0]?.title?.name || null,
      embedUrl:     `https://pluto.tv/en/live-tv/${c.slug}`,
      streamUrl:    c.stitched?.urls?.[0]?.url || null,
      ytEmbedId:    null,
      source:       'pluto',
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return mapped.length ? mapped : FALLBACK_CHANNELS;
}
