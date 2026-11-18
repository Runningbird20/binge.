// The embed servers the player can use, best first: each one's id, label,
// what it supports and how to build its URL. Plain data with no imports, so
// the server's uptime probe (checkServers in server/routes/cron.js) reads
// this same list instead of a hand-kept copy. A plain .js ES module, never
// .mjs: Vercel's build compiles it to CommonJS for the API function, and the
// server requires it on first use, not at startup (as with sportsFeeds.js).
// The player's logic around it (ranking, failover timings, URL options) is in
// embedProviders.js.
//
// Embed servers, best first. VidRift and Vidy lead: in testing they played
// every title tried, including a new 2026 K-drama episode that vidsrc.ru
// and 2Embed didn't have (identical on their own sites, so it's catalog
// coverage, not our embed), and both report playback time for failover.
// VidRift, Vidy and CineSrc were found via the sites they power
// (7movies.ac, movy.sx, shuttletv.su) and are documented embed APIs. Verified 2026-10-07 by loading each in a real
// browser, embedded in an iframe on a non-provider origin, and watching for
// an actual HLS/MP4 stream (a 200 page proves nothing — vsembed.ru serves
// its page but shows "This media is unavailable": its stream backend,
// data.vidsrc.sh, resets every connection). vidsrc.ru is a different
// service from vsembed.ru despite the name.
// Removed that day: vsembed.su (domain now DNS-sinkholed as malicious),
// multiembed.mov (connection reset), autoembed.co (no stream).
// Removed 2026-11-05: vidsrc.rip ("VidSrc RIP"). Its domain served an ad-filled
// news site, then a "Redirecting…" page, instead of a player.
// Added 2026-11-09: VixSrc, VidSpark, VidCore and EmbedWave, the ones of ~30
// candidates that played Fight Club, a 2026 film, Game of Thrones 1x1, an
// episode aired 4 days earlier and a new K-drama episode, in Chrome on a
// non-provider origin, with and without the sandbox. Didn't make it:
// embed.su and vidsrc.cc (refuse to be framed), VidFast (stuck "fetching"),
// 111movies, PrimeSrc, VidJoy (a fake YouTube frame), Vidzy (French audio),
// moviesapi.to (VidSpark's own backend again). vidking.net, vidsrc.xyz/.icu/
// .vip and rivestream.org didn't resolve at all; multiembed, vidora.su,
// autoembed.cc and embed-api.stream were sinkholed on the test network, so
// they're untested, not rejected.
//   events:    sends PLAYER_EVENT postMessages (play/timeupdate), so the
//              player can confirm real playback instead of guessing
//   subtitles: accepts a default subtitle language parameter
//   idKinds:   which external ids the URL accepts
//   types:     media types it actually streams
//   clickToStart: often waits for the viewer's click to start, so no
//              playback report yet doesn't mean it refuses the sandbox
//              (usePopupSandbox)
//   sandbox:   plays in a sandboxed iframe, which blocks its pop-ups and
//              redirects (utils/popupSandbox.js). Only true sandboxes it: an
//              untested server loads normally. Retested 2026-11-16 in Chrome
//              157 and in WebKit (Safari's engine), on a non-provider origin,
//              sandboxed and not, on Fight Club, Project Hail Mary (2026) and
//              GoT 1x1. A server counted as playing once its full-length
//              video had played 5 seconds. VidRift, CineSrc, VidSpark and
//              EmbedWave played sandboxed on every title; VidCore played
//              sandboxed as often as unsandboxed (see it). VidLink, VixSrc and
//              both VidSrcs show a "disable the sandbox" page (while still
//              posting playback times), Vidy an ad page, 2Embed an adult ad
//              page, and VidSrc Classic "can't be embedded in a sandboxed
//              frame"; all but VidSrc Classic play unsandboxed. Videasy's
//              domain no longer resolves.
// The sandbox a server with `sandbox: true` loads in (popupSandbox.js).
// No allow-popups, allow-popups-to-escape-sandbox, allow-top-navigation*,
// allow-modals (alert/confirm traps) or allow-downloads. allow-same-origin
// keeps the player's own storage and CORS requests working; it can't lift
// the sandbox because the frame is cross-origin. WebKit (Safari, every iPhone
// browser) doesn't know allow-presentation or allow-orientation-lock: it logs
// an error and ignores just those two. `npm run check:sandbox` retests every
// server's flag with these.
export const SANDBOX_FLAGS = 'allow-scripts allow-same-origin allow-forms allow-presentation allow-orientation-lock allow-pointer-lock';

export const EMBED_SERVERS = [
  {
    // https://vidrift.net/docs — TMDB ids only; posts vidrift:progress
    // (currentTime) every 5s while playing. Played every title tested,
    // including new K-drama episodes other servers lacked. 2026-11-16, in a
    // fresh browser: about 13s into playback its own page sent the player to
    // ad pages (an "ad blocker" offer, a suggestive game ad), sandboxed or not. A
    // sandbox can't stop a frame navigating itself, only pop-ups and redirects
    // of the whole tab.
    id: 'vidrift',
    label: 'VidRift',
    sandbox: true, // plays sandboxed
    events: true,
    idKinds: ['tmdb'],
    types: ['movie', 'tv_show'],
    buildUrl(id, mediaType, season, episode) {
      const path = mediaType === 'tv_show' ? `/embed/tv/${id.value}/${season}/${episode}` : `/embed/movie/${id.value}`;
      const url = new URL(path, 'https://embed.vidrift.net');
      url.searchParams.set('brand', 'binge.');
      url.searchParams.set('brandColor', 'f4f6f8');
      return url.toString();
    },
  },
  {
    // https://www.vidy.st (#docs) — posts PLAYER_EVENT play/timeupdate.
    id: 'vidy',
    label: 'Vidy',
    sandbox: false, // sandboxed it shows an "Ad Blocker Pro" ad page instead
    events: true,
    idKinds: ['tmdb'],
    types: ['movie', 'tv_show'],
    silentPreload: true,
    buildUrl(id, mediaType, season, episode, subtitleLang, { startAt, noAutoplay } = {}) {
      const isTV = mediaType === 'tv_show';
      const url = new URL(isTV ? `/tv/${id.value}/${season}/${episode}` : `/movie/${id.value}`, 'https://vidy.st');
      url.searchParams.set('color', 'F4F6F8');
      url.searchParams.set('autoplay', noAutoplay ? 'false' : 'true');
      if (startAt > 0) url.searchParams.set('progress', String(startAt));
      if (isTV) {
        url.searchParams.set('nextEpisode', 'true');
        // Auto-next is ours (Up Next card), not the player's.
      }
      return url.toString();
    },
  },
  {
    id: 'vidlink',
    label: 'VidLink',
    sandbox: false, // "Please Disable Sandbox"
    events: true,
    idKinds: ['tmdb'],
    types: ['movie', 'tv_show'],
    silentPreload: true,
    buildUrl(id, mediaType, season, episode, subtitleLang, { startAt, noAutoplay } = {}) {
      const isTV = mediaType === 'tv_show';
      const autoplay = noAutoplay ? 'false' : 'true';
      const base = isTV
        ? `https://vidlink.pro/tv/${id.value}/${season}/${episode}?autoplay=${autoplay}&nextbutton=true`
        : `https://vidlink.pro/movie/${id.value}?autoplay=${autoplay}`;
      // Documented startAt (seconds).
      return startAt > 0 ? `${base}&startAt=${startAt}` : base;
    },
  },
  {
    // https://cinesrc.st/docs — posts cinesrc:timeupdate { currentTime }.
    // subtitlelang (a language name) is undocumented but is what
    // shuttletv.su sends; harmless if ignored. The player passes the name as
    // subtitleLangName (embedProviders.js buildUrl), so this list needs no imports.
    id: 'cinesrc',
    label: 'CineSrc',
    sandbox: true, // plays sandboxed
    events: true,
    subtitles: true,
    idKinds: ['tmdb'],
    types: ['movie', 'tv_show'],
    silentPreload: true,
    buildUrl(id, mediaType, season, episode, subtitleLang, { startAt, lowBandwidth, noAutoplay, subtitleLangName } = {}) {
      const isTV = mediaType === 'tv_show';
      const url = new URL(isTV ? `/embed/tv/${id.value}` : `/embed/movie/${id.value}`, 'https://cinesrc.st');
      if (isTV) { url.searchParams.set('s', season); url.searchParams.set('e', episode); }
      url.searchParams.set('autoplay', noAutoplay ? 'false' : 'true');
      if (startAt > 0) {
        url.searchParams.set('t', String(startAt));
        url.searchParams.set('continueprompt', 'false');
      }
      if (lowBandwidth) url.searchParams.set('quality', '720');
      url.searchParams.set('color', '#f4f6f8');
      url.searchParams.set('prioritize', 'true');
      url.searchParams.set('autonext', 'false');
      if (subtitleLang) {
        url.searchParams.set('subtitles', 'auto');
        url.searchParams.set('subtitlelang', subtitleLangName || subtitleLang);
      }
      return url.toString();
    },
  },
  {
    // https://vixsrc.to — movie/{tmdb|imdb}, tv/{id}/{s}/{e}. Posts
    // PLAYER_EVENT play/pause/seeked/ended/timeupdate, with the event under
    // `event` rather than `data`. Plays the title's original-language track
    // (an Italian dub is the second track). Autoplays and ignores
    // autoplay=false, so no silent preload.
    id: 'vixsrc',
    label: 'VixSrc',
    sandbox: false, // "Please Disable Sandbox"
    events: true,
    idKinds: ['tmdb', 'imdb'],
    types: ['movie', 'tv_show'],
    buildUrl(id, mediaType, season, episode, subtitleLang, { startAt } = {}) {
      const isTV = mediaType === 'tv_show';
      const url = new URL(isTV ? `/tv/${id.value}/${season}/${episode}` : `/movie/${id.value}`, 'https://vixsrc.to');
      url.searchParams.set('primaryColor', 'F4F6F8');
      if (startAt > 0) url.searchParams.set('startAt', String(Math.floor(startAt)));
      return url.toString();
    },
  },
  {
    // https://vidsrc.ru/docs — movie/{tmdb|imdb}, tv/{id}/{s}/{e}. Posts
    // MEDIA_DATA progress messages to the parent window.
    id: 'vidsrc-ru',
    label: 'VidSrc',
    sandbox: false, // "Restricted Embed Detected"
    events: true,
    idKinds: ['tmdb', 'imdb'],
    types: ['movie', 'tv_show'],
    silentPreload: true,
    buildUrl(id, mediaType, season, episode, subtitleLang, { noAutoplay } = {}) {
      const isTV = mediaType === 'tv_show';
      const url = new URL(isTV ? `/tv/${id.value}/${season}/${episode}` : `/movie/${id.value}`, 'https://vidsrc.ru');
      url.searchParams.set('autoplay', noAutoplay ? 'false' : 'true');
      url.searchParams.set('colour', 'f4f6f8');
      url.searchParams.set('pausescreen', 'true');
      if (isTV) url.searchParams.set('autonextepisode', 'false');
      return url.toString();
    },
  },
  {
    id: 'vidsrc-su',
    label: 'VidSrc SU',
    sandbox: false, // "Restricted Embed Detected"
    events: true,
    idKinds: ['tmdb'],
    types: ['movie', 'tv_show'],
    buildUrl(id, mediaType, season, episode) {
      return mediaType === 'tv_show'
        ? `https://vidsrc.su/embed/tv/${id.value}/${season}/${episode}`
        : `https://vidsrc.su/embed/movie/${id.value}`;
    },
  },
  {
    // https://vidspark.to — movie/{tmdb|imdb}, tv/{id}/{s}/{e}. Posts
    // { source: 'vidspark-player', event, currentTime, duration } and takes
    // { action } commands. It never starts by itself (there's no autoplay
    // parameter), so the player sends { action: 'play' } once it loads
    // (EmbedPlayer's handleFrameLoad); a preload stays silent. That started
    // movies and some episodes in testing; on others its player only loads
    // the video after a real click, so it ranks below the servers that
    // autoplay (an automatically chosen server gets FAILOVER_SECONDS).
    // 2026-11-16: about a third of loads still needed clicks, sandboxed or
    // not (clickToStart).
    id: 'vidspark',
    label: 'VidSpark',
    sandbox: true, // plays sandboxed (unsandboxed, its first clicks opened pop-ups)
    clickToStart: true,
    events: true,
    idKinds: ['tmdb', 'imdb'],
    types: ['movie', 'tv_show'],
    silentPreload: true,
    buildUrl(id, mediaType, season, episode, subtitleLang, { startAt } = {}) {
      const isTV = mediaType === 'tv_show';
      const url = new URL(isTV ? `/tv/${id.value}/${season}/${episode}` : `/movie/${id.value}`, 'https://vidspark.to');
      url.searchParams.set('theme', 'F4F6F8');
      if (startAt > 0) url.searchParams.set('t', String(Math.floor(startAt)));
      return url.toString();
    },
  },
  {
    // https://vidcore.org — TMDB ids only (IMDb ids 404). Sends no playback
    // messages and ignores its documented startAt. Now and then it shows a
    // full-page ad instead of the player; sandboxed, that can't open anything.
    // 2026-11-16: it wraps cdn.vidspark.to's player behind "install Opera GX /
    // Ad Blocker Pro to unlock the content" gates and fake "not a robot"
    // checks. It played 3 of 8 loads sandboxed and 2 of 8 unsandboxed (none in
    // WebKit); unsandboxed, its gates opened adult and gambling pop-ups.
    id: 'vidcore',
    label: 'VidCore',
    sandbox: true, // plays sandboxed when it plays at all
    idKinds: ['tmdb'],
    types: ['movie', 'tv_show'],
    buildUrl(id, mediaType, season, episode) {
      const path = mediaType === 'tv_show' ? `/embed/tv/${id.value}/${season}/${episode}` : `/embed/movie/${id.value}`;
      const url = new URL(path, 'https://vidcore.org');
      url.searchParams.set('autoplay', 'true');
      return url.toString();
    },
  },
  {
    // https://embedwave.cc/docs — a front for several backends: its own
    // ("nxsha") by default, also CineSrc and Videasy, which are here
    // directly. Sends no playback messages.
    id: 'embedwave',
    label: 'EmbedWave',
    sandbox: true, // plays sandboxed
    idKinds: ['tmdb'],
    types: ['movie', 'tv_show'],
    buildUrl(id, mediaType, season, episode) {
      const path = mediaType === 'tv_show' ? `/embed/tv/${id.value}/${season}/${episode}` : `/embed/movie/${id.value}`;
      const url = new URL(path, 'https://embedwave.cc');
      url.searchParams.set('autoplay', '1');
      return url.toString();
    },
  },
];
