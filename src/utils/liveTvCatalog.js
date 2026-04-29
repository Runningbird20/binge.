// embedUrl is used for the "Watch Live" external link.
// These sites set X-Frame-Options: SAMEORIGIN and cannot be iframed from external domains.
// ytEmbedId: YouTube live-stream video ID for channels that publish one — these CAN be iframed.
// YouTube live-stream IDs are the most reliable free option for major networks.
// CNN, ESPN, TNT etc. are subscription-only and have no free public stream.
const FALLBACK_CHANNELS = [
  { id: 'cbs-news-24-7',    name: 'CBS News 24/7',        category: 'News',        thumbnail: null, nowPlaying: null, embedUrl: 'https://www.cbsnews.com/live/',                          ytEmbedId: 'eNlHqgd6Zs8',  source: 'pluto' },
  { id: 'abc-news-live',    name: 'ABC News Live',         category: 'News',        thumbnail: null, nowPlaying: null, embedUrl: 'https://abcnews.go.com/Live',                            ytEmbedId: 'vOTiJkg1voo',   source: 'pluto' },
  { id: 'nbc-news-now',     name: 'NBC News Now',          category: 'News',        thumbnail: null, nowPlaying: null, embedUrl: 'https://www.nbcnews.com/now',                            ytEmbedId: 'F5uR6qMs5FM',   source: 'pluto' },
  { id: 'bloomberg-tv',     name: 'Bloomberg TV',          category: 'News',        thumbnail: null, nowPlaying: null, embedUrl: 'https://www.bloomberg.com/live',                         ytEmbedId: 'dp8PhLsUcFE',   source: 'pluto' },
  { id: 'al-jazeera',       name: 'Al Jazeera English',   category: 'News',        thumbnail: null, nowPlaying: null, embedUrl: 'https://www.aljazeera.com/live/',                        ytEmbedId: 'h3MuIUncRLU',   source: 'pluto' },
  { id: 'dw-news',          name: 'DW News',               category: 'News',        thumbnail: null, nowPlaying: null, embedUrl: 'https://www.dw.com/en/media-center/live-tv/s-100825',    ytEmbedId: 'KJ0IWqg_mlA',   source: 'pluto' },
  { id: 'france-24-en',     name: 'France 24 English',     category: 'News',        thumbnail: null, nowPlaying: null, embedUrl: 'https://www.france24.com/en/live-news/',                 ytEmbedId: 'h3MuIUncRLU',   source: 'pluto' },
  { id: 'sky-news',         name: 'Sky News',              category: 'News',        thumbnail: null, nowPlaying: null, embedUrl: 'https://news.sky.com/watch-live',                        ytEmbedId: '9Auq9mYxFEE',   source: 'pluto' },
  { id: 'nasa-tv',          name: 'NASA TV',               category: 'Documentary', thumbnail: null, nowPlaying: null, embedUrl: 'https://www.nasa.gov/live/',                             ytEmbedId: '21X5lGlDOfg',   source: 'pluto' },
  { id: 'pluto-action',     name: 'Action Movies',         category: 'Movies',      thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/action-movies-pluto-tv',     ytEmbedId: null,            source: 'pluto' },
  { id: 'pluto-comedy',     name: 'Comedy Central',        category: 'Comedy',      thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/comedy-central-pluto-tv',    ytEmbedId: null,            source: 'pluto' },
  { id: 'pluto-drama',      name: 'Drama Queens',          category: 'Drama',       thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/drama-queens',               ytEmbedId: null,            source: 'pluto' },
  { id: 'pluto-thriller',   name: 'Thrillers',             category: 'Movies',      thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/thrillers-pluto-tv',         ytEmbedId: null,            source: 'pluto' },
  { id: 'pluto-horror',     name: 'Horror 24/7',           category: 'Horror',      thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/horror-24-7',                ytEmbedId: null,            source: 'pluto' },
  { id: 'pluto-anime',      name: 'Anime All Day',         category: 'Anime',       thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/anime-all-day',              ytEmbedId: null,            source: 'pluto' },
  { id: 'pluto-sports',     name: 'Sports Illustrated TV', category: 'Sports',      thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/sports-illustrated-tv',       ytEmbedId: null,            source: 'pluto' },
  { id: 'pluto-kids',       name: 'Kids Zone',             category: 'Kids',        thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/kid-zone',                   ytEmbedId: null,            source: 'pluto' },
  { id: 'pluto-true-crime', name: 'True Crime',            category: 'Documentary', thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/true-crime-network',          ytEmbedId: null,            source: 'pluto' },
  { id: 'pluto-classic-tv', name: 'Classic TV',            category: 'Entertainment',thumbnail: null,nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/classic-tv',                  ytEmbedId: null,            source: 'pluto' },
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

// ── M3U parser ──────────────────────────────────────────────────────────────

function parseM3u(text) {
  const lines = text.split('\n');
  const channels = [];
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith('#EXTINF')) {
      // Extract attributes from the EXTINF line
      const nameMatch  = line.match(/,(.+)$/);
      const logoMatch  = line.match(/tvg-logo="([^"]*)"/);
      const groupMatch = line.match(/group-title="([^"]*)"/);
      const idMatch    = line.match(/tvg-id="([^"]*)"/);

      current = {
        name:      nameMatch  ? nameMatch[1].trim()  : 'Unknown',
        thumbnail: logoMatch  ? logoMatch[1].trim()  : null,
        category:  groupMatch ? groupMatch[1].trim() : 'General',
        tvgId:     idMatch    ? idMatch[1].trim()    : null,
      };
    } else if (line && !line.startsWith('#') && current) {
      // This line is the stream URL
      const id = current.tvgId
        ? `iptv-${current.tvgId}`
        : `iptv-${current.name.toLowerCase().replace(/\s+/g, '-')}-${channels.length}`;

      channels.push({
        id,
        name:       current.name,
        category:   current.category || 'General',
        thumbnail:  current.thumbnail || null,
        nowPlaying: null,
        embedUrl:   null,
        streamUrl:  line,
        ytEmbedId:  null,
        source:     'iptv',
      });
      current = null;
    }
  }

  return channels;
}

// Normalise iptv-org category labels to match existing CATEGORY_ICONS keys
const CATEGORY_MAP = {
  'Animation':     'Anime',
  'Business':      'News',
  'Classic':       'Classic',
  'Comedy':        'Comedy',
  'Cooking':       'Food',
  'Documentary':   'Documentary',
  'Education':     'Science',
  'Entertainment': 'Entertainment',
  'Family':        'Kids',
  'Fashion':       'Lifestyle',
  'Food':          'Food',
  'General':       'Entertainment',
  'Health':        'Lifestyle',
  'History':       'History',
  'Kids':          'Kids',
  'Lifestyle':     'Lifestyle',
  'Movies':        'Movies',
  'Music':         'Music',
  'Nature':        'Nature',
  'News':          'News',
  'Outdoor':       'Nature',
  'Science':       'Science',
  'Series':        'Drama',
  'Sports':        'Sports',
  'Travel':        'Travel',
  'Weather':       'News',
};

function normaliseCategory(raw) {
  if (!raw) return 'Entertainment';
  const trimmed = raw.trim();
  return CATEGORY_MAP[trimmed] || trimmed;
}

// ── iptv-org fetch ──────────────────────────────────────────────────────────

// These are GitHub-Pages hosted so they include CORS headers.
const IPTV_ORG_PLAYLISTS = [
  // US-specific list first — this is the best source for CNN, ESPN, major US nets.
  // Note: many of these streams are unofficial and may be intermittently unavailable.
  { url: 'https://iptv-org.github.io/iptv/countries/us.m3u',             label: 'Entertainment', limit: 120 },
  { url: 'https://iptv-org.github.io/iptv/categories/news.m3u',          label: 'News',          limit: 80  },
  { url: 'https://iptv-org.github.io/iptv/categories/sports.m3u',        label: 'Sports',        limit: 80  },
  { url: 'https://iptv-org.github.io/iptv/categories/entertainment.m3u', label: 'Entertainment', limit: 60  },
  { url: 'https://iptv-org.github.io/iptv/categories/movies.m3u',        label: 'Movies',        limit: 60  },
  { url: 'https://iptv-org.github.io/iptv/categories/documentary.m3u',   label: 'Documentary',   limit: 60  },
  { url: 'https://iptv-org.github.io/iptv/categories/music.m3u',         label: 'Music',         limit: 60  },
  { url: 'https://iptv-org.github.io/iptv/categories/kids.m3u',          label: 'Kids',          limit: 60  },
  { url: 'https://iptv-org.github.io/iptv/categories/comedy.m3u',        label: 'Comedy',        limit: 60  },
];

async function fetchIptvOrgChannels() {
  const results = await Promise.allSettled(
    IPTV_ORG_PLAYLISTS.map(({ url, label, limit }) =>
      fetch(url, { signal: AbortSignal.timeout(12000) })
        .then(r => r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))
        .then(text => {
          const parsed = parseM3u(text).slice(0, limit);
          return parsed.map(ch => ({
            ...ch,
            category: normaliseCategory(ch.category || label),
          }));
        })
    )
  );

  const seen = new Set();
  const channels = [];

  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const ch of result.value) {
      // Deduplicate by stream URL
      if (!ch.streamUrl || seen.has(ch.streamUrl)) continue;
      seen.add(ch.streamUrl);
      channels.push(ch);
    }
  }

  return channels;
}

// ── Public export ────────────────────────────────────────────────────────────

export async function fetchClientLiveTvChannels() {
  // Fetch Pluto TV and iptv-org in parallel
  const [plutoResult, iptvResult] = await Promise.allSettled([
    fetchPlutoChannels(),
    fetchIptvOrgChannels(),
  ]);

  const pluto = plutoResult.status === 'fulfilled' ? plutoResult.value : FALLBACK_CHANNELS;
  const iptv  = iptvResult.status  === 'fulfilled' ? iptvResult.value  : [];

  // Pluto channels first, then iptv-org channels sorted alphabetically
  const iptvSorted = iptv.sort((a, b) => a.name.localeCompare(b.name));
  return [...pluto, ...iptvSorted];
}

async function fetchPlutoChannels() {
  const now  = new Date();
  const stop = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const fmt  = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const url  = `https://api.pluto.tv/v2/channels?start=${fmt(now)}&stop=${fmt(stop)}&appName=web&appVersion=na&clientID=na&clientModelNumber=na&serverSideAds=false&constraints=&marketingRegion=US`;

  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Pluto TV ${response.status}`);

  const payload  = await response.json();
  const channels = Array.isArray(payload) ? payload : payload.channels || [];
  const mapped   = channels
    .filter(c => c.isStitched !== false && c.visibility !== 'private')
    .map(mapPlutoChannel)
    .sort((a, b) => a.name.localeCompare(b.name));

  return mapped.length ? mapped : FALLBACK_CHANNELS;
}
