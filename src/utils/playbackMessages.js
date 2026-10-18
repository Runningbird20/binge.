// Normalizes the playback messages embed servers post to the parent page
// (time / duration / play-pause-ended), shared by the full player and the
// mini-player.

// One normalized reading from any server's postMessage, or null.
export function readPlayback(raw) {
  let data = raw;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { return null; }
  }
  if (!data || typeof data !== 'object') return null;
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
    const event = data.data || {};
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
