const express = require('express');

const router = express.Router();

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ─── Pluto TV ────────────────────────────────────────────────────────────────

let plutoCache = null;
let plutoCacheTime = 0;

async function fetchPlutoChannels() {
  if (plutoCache && Date.now() - plutoCacheTime < CACHE_TTL) return plutoCache;

  try {
    const now  = new Date();
    const stop = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const fmt  = d => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
    const url  = `https://api.pluto.tv/v2/channels?start=${fmt(now)}&stop=${fmt(stop)}&appName=web&appVersion=na&clientID=na&clientModelNumber=na&serverSideAds=false&constraints=&marketingRegion=US`;

    const res = await fetch(url, {
      headers: {
        'Accept':     'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Origin':     'https://pluto.tv',
        'Referer':    'https://pluto.tv/',
      },
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) throw new Error(`Pluto TV API ${res.status}`);

    const data     = await res.json();
    const raw      = Array.isArray(data) ? data : (data.channels || []);
    const channels = raw
      .filter(ch => ch.isStitched !== false && ch.visibility !== 'private')
      .map(ch => ({
        id:           ch._id || ch.id,
        name:         ch.name,
        slug:         ch.slug,
        category:     ch.category || ch.genre || 'Entertainment',
        thumbnail:    ch.thumbnail?.path || ch.logo?.path || ch.colorLogoPNG?.path || null,
        featuredImage:ch.featuredImage?.path || null,
        summary:      ch.summary || ch.description || '',
        nowPlaying:   ch.timelines?.[0]?.title?.name || null,
        embedUrl:     `https://pluto.tv/en/live-tv/${ch.slug}`,
        streamUrl:    ch.stitched?.urls?.[0]?.url || null,
        ytEmbedId:    null,
        source:       'pluto',
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    if (channels.length > 0) {
      plutoCache     = channels;
      plutoCacheTime = Date.now();
    }
    return channels.length ? channels : getPlutoFallback();
  } catch (err) {
    console.log('Pluto TV unavailable:', err.message);
    return plutoCache || getPlutoFallback();
  }
}

function getPlutoFallback() {
  return [
    { id: 'pluto-action',   name: 'Action Movies',       category: 'Movies',       thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/action-movies-pluto-tv',   streamUrl: null, ytEmbedId: null, source: 'pluto' },
    { id: 'pluto-comedy',   name: 'Comedy Central',      category: 'Comedy',       thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/comedy-central-pluto-tv',  streamUrl: null, ytEmbedId: null, source: 'pluto' },
    { id: 'pluto-drama',    name: 'Drama Queens',        category: 'Drama',        thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/drama-queens',              streamUrl: null, ytEmbedId: null, source: 'pluto' },
    { id: 'pluto-horror',   name: 'Horror 24/7',         category: 'Horror',       thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/horror-24-7',               streamUrl: null, ytEmbedId: null, source: 'pluto' },
    { id: 'pluto-anime',    name: 'Anime All Day',       category: 'Anime',        thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/anime-all-day',             streamUrl: null, ytEmbedId: null, source: 'pluto' },
    { id: 'pluto-sports',   name: 'Sports Illustrated',  category: 'Sports',       thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/sports-illustrated-tv',    streamUrl: null, ytEmbedId: null, source: 'pluto' },
    { id: 'pluto-kids',     name: 'Kids Zone',           category: 'Kids',         thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/kid-zone',                  streamUrl: null, ytEmbedId: null, source: 'pluto' },
    { id: 'pluto-crime',    name: 'True Crime',          category: 'Documentary',  thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/true-crime-files',          streamUrl: null, ytEmbedId: null, source: 'pluto' },
    { id: 'pluto-classic',  name: 'Classic TV',          category: 'Entertainment',thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/classic-tv',                streamUrl: null, ytEmbedId: null, source: 'pluto' },
    { id: 'pluto-music',    name: 'MTV Classic',         category: 'Music',        thumbnail: null, nowPlaying: null, embedUrl: 'https://pluto.tv/en/live-tv/mtv-classic',               streamUrl: null, ytEmbedId: null, source: 'pluto' },
  ];
}

// ─── Routes ──────────────────────────────────────────────────────────────────

router.get('/channels', async (req, res) => {
  try {
    const channels = await fetchPlutoChannels();
    res.json({ channels, total: channels.length });
  } catch (err) {
    console.error('Live TV channels error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/channels/refresh', async (req, res) => {
  plutoCache = null;
  plutoCacheTime = 0;
  try {
    const channels = await fetchPlutoChannels();
    res.json({ channels, total: channels.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
