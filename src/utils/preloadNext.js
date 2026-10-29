// The next episode's hidden preload frame must never be heard. Embed
// players are cross-origin, so the page can't mute them; instead the frame
// only loads servers whose autoplay can be switched off in the URL, denies
// autoplay, and is removed the moment it reports playback anyway (some
// browsers, Safari included, let such a frame play with sound).

// A playback message from the preload frame that means its video is running.
export function preloadIsPlaying(reading) {
  if (!reading) return false;
  if (reading.state === 'play') return true;
  return reading.state !== 'pause' && reading.state !== 'ended' && Number.isFinite(reading.time) && reading.time > 0.5;
}
