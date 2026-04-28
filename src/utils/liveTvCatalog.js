// embedUrl is used for the "Watch Live" external link.
// These sites set X-Frame-Options: SAMEORIGIN and cannot be iframed from external domains.
// ytEmbedId: YouTube live-stream video ID for channels that publish one — these CAN be iframed.
const FALLBACK_CHANNELS = [
  { id: 'cbs-news-24-7',  name: 'CBS News 24/7',        category: 'News',        thumbnail: null, nowPlaying: null, embedUrl: 'https://www.cbsnews.com/live/',                            ytEmbedId: 'eNlHqgd6Zs8' },
  { id: 'al-jazeera',    name: 'Al Jazeera English',    category: 'News',        thumbnail: null, nowPlaying: null, embedUrl: 'https://www.aljazeera.com/live/',                          ytEmbedId: 'h3MuIUncRLU' },
  { id: 'dw-news',       name: 'DW News',               category: 'News',        thumbnail: null, nowPlaying: null, embedUrl: 'https://www.dw.com/en/media-center/live-tv/s-100825',      ytEmbedId: 'KJ0IWqg_mlA' },
  { id: 'nasa-tv',       name: 'NASA TV',               category: 'Documentary', thumbnail: null, nowPlaying: null, embedUrl: 'https://www.nasa.gov/live/',                               ytEmbedId: '21X5lGlDOfg' },
  { id: 'pluto-action',  name: 'Action Movies',         category: 'Movies',      thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/action-movies-pluto-tv',       ytEmbedId: null },
  { id: 'pluto-comedy',  name: 'Comedy Central',        category: 'Comedy',      thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/comedy-central-pluto-tv',      ytEmbedId: null },
  { id: 'pluto-drama',   name: 'Drama Queens',          category: 'Drama',       thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/drama-queens',                ytEmbedId: null },
  { id: 'pluto-thriller',name: 'Thrillers',             category: 'Movies',      thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/thrillers-pluto-tv',           ytEmbedId: null },
  { id: 'pluto-horror',  name: 'Horror 24/7',           category: 'Horror',      thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/horror-24-7',                 ytEmbedId: null },
  { id: 'pluto-anime',   name: 'Anime All Day',         category: 'Anime',       thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/anime-all-day',               ytEmbedId: null },
  { id: 'pluto-sports',  name: 'Sports Illustrated TV', category: 'Sports',      thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/sports-illustrated-tv',        ytEmbedId: null },
  { id: 'pluto-kids',    name: 'Kids Zone',             category: 'Kids',        thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/kid-zone',                    ytEmbedId: null },
];

function mapPlutoChannel(channel) {
  return {
    id: channel._id || channel.id,
    name: channel.name,
    slug: channel.slug,
    category: channel.category || channel.genre || 'Entertainment',
    thumbnail: channel.thumbnail?.path || channel.logo?.path || channel.colorLogoPNG?.path || null,
    featuredImage: channel.featuredImage?.path || null,
    summary: channel.summary || channel.description || '',
    nowPlaying: channel.timelines?.[0]?.title?.name || null,
    embedUrl: `https://pluto.tv/en/live-tv/${channel.slug}`,
    streamUrl: channel.stitched?.urls?.[0]?.url || null,
    ytEmbedId: null,
    source: 'pluto',
  };
}

export async function fetchClientLiveTvChannels() {
  try {
    const now = new Date();
    const stop = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const fmt = (value) => value.toISOString().replace(/\.\d{3}Z$/, 'Z');
    const url = `https://api.pluto.tv/v2/channels?start=${fmt(now)}&stop=${fmt(stop)}&appName=web&appVersion=na&clientID=na&clientModelNumber=na&serverSideAds=false&constraints=&marketingRegion=US`;

    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Pluto TV request failed with status ${response.status}`);
    }

    const payload = await response.json();
    const channels = Array.isArray(payload) ? payload : payload.channels || [];
    const mapped = channels
      .filter((channel) => channel.isStitched !== false && channel.visibility !== 'private')
      .map(mapPlutoChannel)
      .sort((left, right) => left.name.localeCompare(right.name));

    return mapped.length ? mapped : FALLBACK_CHANNELS;
  } catch {
    return FALLBACK_CHANNELS;
  }
}
