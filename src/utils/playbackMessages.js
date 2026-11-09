// Normalizes the playback messages embed servers post to the parent page
// (time / duration / play-pause-ended), and reads which episode VidRift says
// is playing.

// One normalized reading from any server's postMessage, or null.
export function readPlayback(raw) {
  let data = raw;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { return null; }
  }
  if (!data || typeof data !== 'object') return null;
  // VidSpark: { source, event, currentTime, duration }, no type.
  if (data.source === 'vidspark-player') {
    const reading = { time: Number(data.currentTime), duration: Number(data.duration) };
    if (data.event === 'play') reading.state = 'play';
    if (data.event === 'pause') reading.state = 'pause';
    if (data.event === 'ended') reading.state = 'ended';
    return reading;
  }
  const type = data.type || '';
  if (type.startsWith('vidrift:')) {
    if (type === 'vidrift:progress') return { time: Number(data.currentTime), duration: Number(data.duration) };
    if (type === 'vidrift:paused') return { state: 'pause', time: Number(data.currentTime) };
    if (type === 'vidrift:unpaused') return { state: 'play', time: Number(data.currentTime) };
    if (type === 'vidrift:ended') return { state: 'ended' };
    if (type === 'vidrift:nextup') return { time: Number(data.currentTime), duration: Number(data.duration) };
    return null;
  }
  if (type.startsWith('cinesrc:')) {
    if (type === 'cinesrc:timeupdate' || type === 'cinesrc:seeked') return { time: Number(data.currentTime), duration: Number(data.duration) };
    if (type === 'cinesrc:play') return { state: 'play' };
    if (type === 'cinesrc:pause') return { state: 'pause' };
    if (type === 'cinesrc:ended') return { state: 'ended' };
    return null;
  }
  if (type === 'PLAYER_EVENT') {
    // Vidy, VidLink and Videasy put the event under `data`; VixSrc under `event`.
    const event = data.data || data.event || {};
    const reading = { time: Number(event.currentTime), duration: Number(event.duration) };
    if (event.event === 'play') reading.state = 'play';
    if (event.event === 'pause') reading.state = 'pause';
    if (event.event === 'ended') reading.state = 'ended';
    return reading;
  }
  if (type === 'MEDIA_DATA') {
    const media = typeof data.data === 'string' ? (() => { try { return JSON.parse(data.data); } catch { return null; } })() : data.data;
    const progress = media?.progress || (media && Object.values(media)[0]?.progress);
    if (!progress) return null;
    return { time: Number(progress.watched), duration: Number(progress.duration) };
  }
  return null;
}

// The episode a server's message says is playing: VidRift sends tmdbId, season
// and episode with every message, and vidrift:episode just before it switches
// episodes inside its own player (its Next button, Episodes menu or own Up
// Next). Null for other servers, movies, another title, and
// vidrift:nextup-play (which names the episode that just finished).
export function readServerEpisode(raw, tmdbId) {
  let data = raw;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { return null; }
  }
  if (!data || typeof data !== 'object') return null;
  const type = String(data.type || '');
  if (!type.startsWith('vidrift:') || type === 'vidrift:nextup-play') return null;
  if (tmdbId != null && data.tmdbId != null && String(data.tmdbId) !== String(tmdbId)) return null;
  const season = Number(data.season);
  const episode = Number(data.episode);
  if (!Number.isInteger(season) || !Number.isInteger(episode) || season < 1 || episode < 1) return null;
  return { season, episode, switching: type === 'vidrift:episode' };
}
