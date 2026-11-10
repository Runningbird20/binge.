// binge. frame bridge (phone apps), injected into every frame of the page.
// It lets the website (src/utils/frameBridge.js, useAppBridge) follow and
// steer the video inside a server's player, which a browser never allows
// across sites: it reports the video's time, seeks / plays / pauses, and
// draws binge.'s captions over the video inside that frame.
// Keep the Android (assets/frame-bridge.js) and iOS (BingeMobile/frame-bridge.js)
// copies identical: src/utils/frameBridge.test.js checks.
(function () {
  if (window.top === window || window.__bingeFrame) return;
  window.__bingeFrame = true;
  var nonce = '';
  var cues = null;
  var shift = 0;
  var box = null;
  var shown = '';
  var drawTimer = null;

  // The biggest video in this frame that has loaded something.
  function pick() {
    var list = document.getElementsByTagName('video');
    var best = null;
    var area = 0;
    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      var r = v.getBoundingClientRect();
      var a = r.width * r.height;
      if (a > area && (v.readyState > 0 || v.currentTime > 0)) { best = v; area = a; }
    }
    return best;
  }

  function ahead(v) {
    var b = v.buffered;
    for (var i = 0; i < b.length; i++) {
      if (b.start(i) <= v.currentTime + 0.3 && b.end(i) > v.currentTime) return b.end(i) - v.currentTime;
    }
    return 0;
  }

  // Commands come from binge.'s page (the top) through each parent frame.
  function relay(message) {
    for (var i = 0; i < window.frames.length; i++) {
      try { window.frames[i].postMessage(message, '*'); } catch (e) { /* gone */ }
    }
  }

  window.addEventListener('message', function (event) {
    var m = event.data;
    if (!m || m.type !== 'binge-frame-cmd') return;
    if (event.source !== window.parent && event.source !== window.top) return;
    relay(m);
    var v = pick();
    if (m.cmd === 'hello') {
      nonce = String(m.nonce || '');
    } else if (m.cmd === 'seek' && v && isFinite(m.t)) {
      try { v.currentTime = Math.max(0, Number(m.t)); } catch (e) { /* not seekable yet */ }
    } else if (m.cmd === 'play' && v) {
      var p = v.play();
      if (p && p.catch) p.catch(function () {});
    } else if (m.cmd === 'pause' && v) {
      v.pause();
    } else if (m.cmd === 'captions') {
      cues = m.cues && m.cues.length ? m.cues : null;
      if (typeof m.shift === 'number') shift = m.shift;
      shown = null;
      startDrawing();
    } else if (m.cmd === 'shift' && typeof m.shift === 'number') {
      shift = m.shift;
    }
  });

  setInterval(function () {
    var v = pick();
    if (!v || !nonce) return;
    try {
      window.top.postMessage({
        type: 'binge-frame', nonce: nonce,
        t: v.currentTime || 0, d: isFinite(v.duration) ? v.duration : 0,
        paused: v.paused, ended: v.ended, h: v.videoHeight || 0,
        ahead: Math.round(ahead(v) * 10) / 10,
      }, '*');
    } catch (e) { /* the page is navigating */ }
  }, 500);

  // The cue(s) on screen at a second: cues are [start, end, text], sorted.
  function textAt(t) {
    var low = 0;
    var high = cues.length;
    while (low < high) {
      var mid = (low + high) >> 1;
      if (cues[mid][0] <= t) low = mid + 1; else high = mid;
    }
    var lines = [];
    for (var i = low - 1; i >= 0 && lines.length < 2 && t - cues[i][0] < 30; i--) {
      if (cues[i][1] > t) lines.unshift(cues[i][2]);
    }
    return lines.join('\n');
  }

  function ensureBox() {
    var host = document.fullscreenElement || document.webkitFullscreenElement || document.body;
    if (!host) return null;
    if (!box) {
      box = document.createElement('div');
      box.setAttribute('aria-live', 'off');
      var s = box.style;
      s.position = 'fixed'; s.left = '50%'; s.bottom = '12%'; s.transform = 'translateX(-50%)';
      s.maxWidth = '88%'; s.textAlign = 'center'; s.whiteSpace = 'pre-line';
      s.font = '600 max(15px, 4.2vmin)/1.3 system-ui, -apple-system, Roboto, sans-serif';
      s.color = '#fff'; s.background = 'rgba(0,0,0,0.62)'; s.padding = '0.15em 0.5em'; s.borderRadius = '4px';
      s.zIndex = '2147483647'; s.pointerEvents = 'none'; s.display = 'none';
    }
    if (box.parentNode !== host) host.appendChild(box);
    return box;
  }

  function draw() {
    var v = pick();
    if (!v) return;
    var text = cues ? textAt(v.currentTime - shift) : '';
    var target = ensureBox();
    if (!target) return;
    if (text !== shown) {
      shown = text;
      target.textContent = text;
      target.style.display = text ? 'block' : 'none';
    }
  }

  function startDrawing() {
    if (drawTimer) clearInterval(drawTimer);
    drawTimer = null;
    if (!cues) { if (box) box.style.display = 'none'; shown = ''; return; }
    drawTimer = setInterval(draw, 100);
  }
})();
