const express = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ─── Pluto TV channel fetcher ─────────────────────────────────────────────────

let channelCache = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function fetchPlutoChannels() {
  // Return cache if fresh
  if (channelCache && Date.now() - cacheTime < CACHE_TTL) {
    return channelCache;
  }

  try {
    const now = new Date();
    const stop = new Date(now.getTime() + 2 * 60 * 60 * 1000); // +2 hours
    const fmt = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

    const url = `https://api.pluto.tv/v2/channels?start=${fmt(now)}&stop=${fmt(stop)}&appName=web&appVersion=na&clientID=na&clientModelNumber=na&serverSideAds=false&constraints=&marketingRegion=US`;

    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Origin': 'https://pluto.tv',
        'Referer': 'https://pluto.tv/',
      },
      signal: AbortSignal.timeout(4000),
    });

    if (!res.ok) {
      console.error('Pluto TV API error:', res.status);
      return getFallbackChannels();
    }

    const data = await res.json();
    const channels = Array.isArray(data) ? data : (data.channels || []);

    const mapped = channels
      .filter(ch => ch.isStitched !== false && ch.visibility !== 'private')
      .map(ch => ({
        id: ch._id || ch.id,
        name: ch.name,
        slug: ch.slug,
        category: ch.category || ch.genre || 'Entertainment',
        thumbnail: ch.thumbnail?.path || ch.logo?.path || ch.colorLogoPNG?.path || null,
        featuredImage: ch.featuredImage?.path || null,
        summary: ch.summary || ch.description || '',
        nowPlaying: ch.timelines?.[0]?.title?.name || null,
        embedUrl: `https://pluto.tv/en/live-tv/${ch.slug}`,
        source: 'pluto',
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    channelCache = mapped;
    cacheTime = Date.now();
    return mapped;

  } catch (err) {
    console.log('Pluto TV API unavailable, using fallback channels:', err.message);
    return getFallbackChannels();
  }
}

// Fallback hardcoded channels if API fails
function getFallbackChannels() {
  return [
    // News
    { id: 'cbs-news-24-7',        name: 'CBS News 24/7',        slug: 'cbs-news', category: 'News', thumbnail: null, embedUrl: 'https://www.cbsnews.com/embed/live/', source: 'other' },
    { id: 'france-24',            name: 'France 24',            slug: 'france-24', category: 'News', thumbnail: null, embedUrl: 'https://static.france24.com/static_n/live/F24_EN_HI_HLS/playlist.m3u8', source: 'other' },
    { id: 'al-jazeera',           name: 'Al Jazeera English',   slug: 'al-jazeera', category: 'News', thumbnail: null, embedUrl: 'https://www.aljazeera.com/live/', source: 'other' },
    { id: 'dw-news',              name: 'DW News',              slug: 'dw-news', category: 'News', thumbnail: null, embedUrl: 'https://www.dw.com/en/media-center/live-tv/s-100825', source: 'other' },
    { id: 'euronews',             name: 'Euronews English',     slug: 'euronews', category: 'News', thumbnail: null, embedUrl: 'https://www.euronews.com/embed-video/livefeed', source: 'other' },
    // Documentary
    { id: 'nasa-tv',              name: 'NASA TV',              slug: 'nasa-tv', category: 'Documentary', thumbnail: null, embedUrl: 'https://www.nasa.gov/wp-content/plugins/nasatv/components/single.html', source: 'other' },
    // Pluto fallbacks
    { id: 'pluto-action',         name: 'Action Movies',        slug: 'action-movies-pluto-tv', category: 'Movies', thumbnail: null, embedUrl: 'https://pluto.tv/en/live-tv/action-movies-pluto-tv', source: 'pluto' },
    { id: 'pluto-comedy',         name: 'Comedy Central',       slug: 'comedy-central-pluto-tv', category: 'Comedy', thumbnail: null, embedUrl: 'https://pluto.tv/en/live-tv/comedy-central-pluto-tv', source: 'pluto' },
    { id: 'pluto-drama',          name: 'Drama Queens',         slug: 'drama-queens', category: 'Drama', thumbnail: null, embedUrl: 'https://pluto.tv/en/live-tv/drama-queens', source: 'pluto' },
    { id: 'pluto-thriller',       name: 'Thrillers',            slug: 'thrillers-pluto-tv', category: 'Movies', thumbnail: null, embedUrl: 'https://pluto.tv/en/live-tv/thrillers-pluto-tv', source: 'pluto' },
    { id: 'pluto-horror',         name: 'Horror 24/7',          slug: 'horror-24-7', category: 'Horror', thumbnail: null, embedUrl: 'https://pluto.tv/en/live-tv/horror-24-7', source: 'pluto' },
    { id: 'pluto-anime',          name: 'Anime All Day',        slug: 'anime-all-day', category: 'Anime', thumbnail: null, embedUrl: 'https://pluto.tv/en/live-tv/anime-all-day', source: 'pluto' },
    { id: 'pluto-true-crime',     name: 'True Crime',           slug: 'true-crime-files', category: 'Documentary', thumbnail: null, embedUrl: 'https://pluto.tv/en/live-tv/true-crime-files', source: 'pluto' },
    { id: 'pluto-history',        name: 'History TV',           slug: 'history-tv', category: 'Documentary', thumbnail: null, embedUrl: 'https://pluto.tv/en/live-tv/history-tv', source: 'pluto' },
    { id: 'pluto-nature',         name: 'Nature TV',            slug: 'nature-tv', category: 'Documentary', thumbnail: null, embedUrl: 'https://pluto.tv/en/live-tv/nature-tv', source: 'pluto' },
    { id: 'pluto-science',        name: 'Science TV',           slug: 'science-tv', category: 'Documentary', thumbnail: null, embedUrl: 'https://pluto.tv/en/live-tv/science-tv', source: 'pluto' },
    { id: 'pluto-sports',         name: 'Sports Illustrated TV', slug: 'sports-illustrated-tv', category: 'Sports', thumbnail: null, embedUrl: 'https://pluto.tv/en/live-tv/sports-illustrated-tv', source: 'pluto' },
    { id: 'pluto-kids',           name: 'Kids Zone',            slug: 'kid-zone', category: 'Kids', thumbnail: null, embedUrl: 'https://pluto.tv/en/live-tv/kid-zone', source: 'pluto' },
    { id: 'pluto-reality',        name: 'Reality TV',           slug: 'reality-tv', category: 'Reality', thumbnail: null, embedUrl: 'https://pluto.tv/en/live-tv/reality-tv', source: 'pluto' },
    { id: 'pluto-classic',        name: 'Classic TV',           slug: 'classic-tv', category: 'Classic', thumbnail: null, embedUrl: 'https://pluto.tv/en/live-tv/classic-tv', source: 'pluto' },
    { id: 'pluto-mtv-classic',    name: 'MTV Classic',          slug: 'mtv-classic', category: 'Music', thumbnail: null, embedUrl: 'https://pluto.tv/en/live-tv/mtv-classic', source: 'pluto' },
  ];
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Get all channels
router.get('/channels', async (req, res) => {
  try {
    const channels = await fetchPlutoChannels();
    res.json({ channels, total: channels.length });
  } catch (err) {
    console.error('Live TV channels error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Force refresh cache
router.post('/channels/refresh', async (req, res) => {
  channelCache = null;
  cacheTime = 0;
  try {
    const channels = await fetchPlutoChannels();
    res.json({ channels, total: channels.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
