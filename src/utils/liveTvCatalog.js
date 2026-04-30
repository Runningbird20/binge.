// Fallback channels used when the server API is unreachable
const FALLBACK_CHANNELS = [
  { id: 'cbs-news-24-7',  name: 'CBS News 24/7',      category: 'News',        thumbnail: null, nowPlaying: null, embedUrl: 'https://www.cbsnews.com/live/',                          ytEmbedId: 'eNlHqgd6Zs8', source: 'pluto' },
  { id: 'abc-news-live',  name: 'ABC News Live',       category: 'News',        thumbnail: null, nowPlaying: null, embedUrl: 'https://abcnews.go.com/Live',                            ytEmbedId: 'vOTiJkg1voo', source: 'pluto' },
  { id: 'nbc-news-now',   name: 'NBC News Now',        category: 'News',        thumbnail: null, nowPlaying: null, embedUrl: 'https://www.nbcnews.com/now',                            ytEmbedId: 'F5uR6qMs5FM', source: 'pluto' },
  { id: 'bloomberg-tv',   name: 'Bloomberg TV',        category: 'News',        thumbnail: null, nowPlaying: null, embedUrl: 'https://www.bloomberg.com/live',                         ytEmbedId: 'dp8PhLsUcFE', source: 'pluto' },
  { id: 'al-jazeera',     name: 'Al Jazeera English',  category: 'News',        thumbnail: null, nowPlaying: null, embedUrl: 'https://www.aljazeera.com/live/',                        ytEmbedId: 'h3MuIUncRLU', source: 'pluto' },
  { id: 'dw-news',        name: 'DW News',             category: 'News',        thumbnail: null, nowPlaying: null, embedUrl: 'https://www.dw.com/en/media-center/live-tv/s-100825',    ytEmbedId: 'KJ0IWqg_mlA', source: 'pluto' },
  { id: 'sky-news',       name: 'Sky News',            category: 'News',        thumbnail: null, nowPlaying: null, embedUrl: 'https://news.sky.com/watch-live',                        ytEmbedId: '9Auq9mYxFEE', source: 'pluto' },
  { id: 'nasa-tv',        name: 'NASA TV',             category: 'Documentary', thumbnail: null, nowPlaying: null, embedUrl: 'https://www.nasa.gov/live/',                             ytEmbedId: '21X5lGlDOfg', source: 'pluto' },
  { id: 'pluto-action',   name: 'Action Movies',       category: 'Movies',      thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/action-movies-pluto-tv',     ytEmbedId: null,          source: 'pluto' },
  { id: 'pluto-comedy',   name: 'Comedy Central',      category: 'Comedy',      thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/comedy-central-pluto-tv',    ytEmbedId: null,          source: 'pluto' },
  { id: 'pluto-drama',    name: 'Drama Queens',        category: 'Drama',       thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/drama-queens',               ytEmbedId: null,          source: 'pluto' },
  { id: 'pluto-thriller', name: 'Thrillers',           category: 'Movies',      thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/thrillers-pluto-tv',         ytEmbedId: null,          source: 'pluto' },
  { id: 'pluto-horror',   name: 'Horror 24/7',         category: 'Horror',      thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/horror-24-7',                ytEmbedId: null,          source: 'pluto' },
  { id: 'pluto-anime',    name: 'Anime All Day',       category: 'Anime',       thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/anime-all-day',              ytEmbedId: null,          source: 'pluto' },
  { id: 'pluto-sports',   name: 'Sports Illustrated',  category: 'Sports',      thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/sports-illustrated-tv',      ytEmbedId: null,          source: 'pluto' },
  { id: 'pluto-kids',     name: 'Kids Zone',           category: 'Kids',        thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/kid-zone',                   ytEmbedId: null,          source: 'pluto' },
  { id: 'pluto-crime',    name: 'True Crime',          category: 'Documentary', thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/true-crime-network',          ytEmbedId: null,          source: 'pluto' },
  { id: 'pluto-classic',  name: 'Classic TV',          category: 'Entertainment',thumbnail: null,nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/classic-tv',                 ytEmbedId: null,          source: 'pluto' },
  { id: 'pluto-music',    name: 'MTV Classic',         category: 'Music',       thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/mtv-classic',                ytEmbedId: null,          source: 'pluto' },
];

// Primary path: server-side proxy that spoofs User-Agent so Pluto API allows it.
// This works on both Vercel and local. Falls back to direct browser fetch, then
// to hardcoded fallback channels.
export async function fetchClientLiveTvChannels() {
  // 1. Try server route (works on both local dev-server and Vercel serverless)
  try {
    const res = await fetch('/api/livetv/channels', {
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const data = await res.json();
      const channels = Array.isArray(data) ? data : (data.channels || []);
      if (channels.length > 0) return channels;
    }
  } catch { /* fall through */ }

  // 2. Direct browser call to Pluto API (works locally but may be CORS-blocked on hosted)
  try {
    return await fetchPlutoChannelsDirect();
  } catch { /* fall through */ }

  // 3. Hardcoded fallback
  return FALLBACK_CHANNELS;
}

async function fetchPlutoChannelsDirect() {
  const now  = new Date();
  const stop = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const fmt  = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const url  = `https://api.pluto.tv/v2/channels?start=${fmt(now)}&stop=${fmt(stop)}&appName=web&appVersion=na&clientID=na&clientModelNumber=na&serverSideAds=false&constraints=&marketingRegion=US`;

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
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
