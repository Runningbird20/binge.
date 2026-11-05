package com.binge.mobile

// Injected (at document start) into binge.'s own pages only, never into the video
// servers' frames, which have a different origin. It talks to MainActivity through the
// `bingeApp` web message channel, which only the site's origin can see:
//   - links that lead off the site (any target, and window.open) go to the phone's
//     browser; new-tab links to the site itself open in place. MainActivity refuses
//     every other way of leaving the site, so a player's ad can't send the app elsewhere;
//   - files the site saves through <a download> blob:/data: links (Download my data,
//     the calendar's .ics, the Wrapped card) are read here and saved by the app,
//     because Android's WebView can't download blob: URLs itself.
object PageScript {
    const val SOURCE = """
(function () {
  if (window.__bingeApp) return;
  window.__bingeApp = true;

  function post(message) {
    try { bingeApp.postMessage(JSON.stringify(message)); } catch (e) { /* no channel: plain WebView */ }
  }

  // The full URL when it leads off this site (or to mail / the phone), else null.
  function outside(href) {
    try {
      var url = new URL(href, location.href);
      if (/^(mailto|tel):${'$'}/.test(url.protocol)) return url.href;
      return /^https?:${'$'}/.test(url.protocol) && url.host !== location.host ? url.href : null;
    } catch (e) { return null; }
  }

  // Read the file now: the site revokes its blob: URL right after the click.
  function save(link) {
    var name = link.getAttribute('download') || 'binge-file';
    fetch(link.href).then(function (response) { return response.blob(); }).then(function (blob) {
      var reader = new FileReader();
      reader.onload = function () {
        post({ type: 'download', name: name, mime: blob.type || 'application/octet-stream', data: String(reader.result).split(',')[1] || '' });
      };
      reader.readAsDataURL(blob);
    }).catch(function () {});
  }

  // true when the app took care of the link.
  function handle(link) {
    if (!link || !link.href) return false;
    if (link.hasAttribute('download') && /^(blob|data):/.test(link.href)) { save(link); return true; }
    var url = outside(link.href);
    if (url) { post({ type: 'open', url: url }); return true; }
    if (link.target === '_blank') { location.href = link.href; return true; }
    return false;
  }

  document.addEventListener('click', function (event) {
    var link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (handle(link)) event.preventDefault();
  }, true);

  // The site creates download links and clicks them from code, without adding them to the page.
  var click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (!handle(this)) return click.apply(this, arguments);
  };

  window.open = function (href) {
    if (!href) return null;
    var url = outside(href);
    if (url) post({ type: 'open', url: url });
    else location.href = new URL(href, location.href).href;
    return null;
  };
})();
"""
}
