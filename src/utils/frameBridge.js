// The phone apps (mobile-android/, mobile-ios/) put a small bridge script
// into every frame of the page, the video servers' included (the website in
// a browser can't reach into another site's frame; the apps can). It reports
// the video's time from whatever frame plays it, and seeks, plays, pauses and
// draws captions there when asked. Same idea as the TV apps' bridge.
//
// Messages from the page to the player frame: { type: 'binge-frame-cmd',
// cmd: 'hello' | 'seek' | 'play' | 'pause' | 'captions' | 'shift', … }; the
// bridge relays them down to nested frames. Frames answer with { type:
// 'binge-frame', nonce, t, d, paused, ended, h, ahead } every half second.
// The nonce (from the page's latest 'hello' to this player frame) keeps other
// frames on the page (trailers, the next episode's preload) from counting.

export function inBingeApp() {
  return typeof navigator !== 'undefined' && /BingeApp\//.test(navigator.userAgent || '');
}

export function newBridgeNonce() {
  return Math.random().toString(36).slice(2, 12);
}

// A reading in usePlaybackMessages' shape, or null.
export function readFrameMessage(data, nonce) {
  if (!data || data.type !== 'binge-frame' || !nonce || data.nonce !== nonce) return null;
  const time = Number(data.t);
  if (!Number.isFinite(time)) return null;
  return {
    time,
    duration: Number(data.d) || 0,
    state: data.ended ? 'ended' : data.paused ? 'pause' : 'play',
    height: Number(data.h) || 0,
    ahead: Number(data.ahead) || 0,
  };
}

export function sendToFrame(iframe, message) {
  try {
    iframe?.contentWindow?.postMessage({ type: 'binge-frame-cmd', ...message }, '*');
  } catch {
    // The frame is gone or reloading; the next tick tries again.
  }
}

// WebVTT (and SRT-style commas) → [{ start, end, text }], sorted.
export function parseVtt(text) {
  const cues = [];
  const seconds = (raw) => {
    const parts = String(raw).trim().replace(',', '.').split(':').map(Number);
    if (parts.length < 2 || parts.length > 3 || parts.some((n) => !Number.isFinite(n))) return null;
    return parts.reduce((total, n) => total * 60 + n, 0);
  };
  const clean = (lines) => lines.join('\n')
    .replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .trim();
  let timing = null;
  let lines = [];
  const finish = () => {
    if (timing && timing.end > timing.start) {
      const body = clean(lines);
      if (body) cues.push({ start: timing.start, end: timing.end, text: body });
    }
    timing = null;
    lines = [];
  };
  String(text || '').replace(/\r\n?/g, '\n').split('\n').forEach((raw) => {
    const line = raw.trim();
    if (line.includes('-->')) {
      if (timing && lines.length && /^\d+$/.test(lines[lines.length - 1])) lines.pop();
      finish();
      const [a, b] = line.split('-->');
      const start = seconds(a);
      const end = seconds(String(b).trim().split(/\s+/)[0]);
      if (start != null && end != null) timing = { start, end };
    } else if (!line) {
      finish();
    } else if (timing) {
      lines.push(raw);
    }
  });
  finish();
  return cues.sort((x, y) => x.start - y.start);
}
