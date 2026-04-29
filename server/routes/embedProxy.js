const express = require('express');
const cheerio = require('cheerio');
const { isAdRequest, AD_DOMAINS } = require('../utils/adBlocklist');

const router = express.Router();

const VERCEL = Boolean(process.env.VERCEL);

// Only allow proxying known embed provider hostnames so this can't be
// abused as a general-purpose web proxy.
const ALLOWED_EMBED_HOSTS = new Set([
  'vidsrc-embed.ru',
  'vidsrc-embed.su',
  'vidsrc.me',
  'vidsrc.to',
  'vidsrc.net',
  'vidsrc.xyz',
  '2embed.stream',
  'www.2embed.stream',
  'autoembed.co',
  'www.autoembed.co',
  'vidlink.pro',
  'www.vidlink.pro',
  'multiembed.mov',
  'www.multiembed.mov',
  'player.smashy.stream',
  'smashy.stream',
  'embed.su',
  'www.embed.su',
  'player.vidsrc.co',
  'vidsrc.co',
  'vsrc.su',
  'www.vsrc.su',
]);

// The JS payload injected at the top of every proxied embed page.
// It overrides the four main ad-delivery vectors before any provider code runs:
//   1. window.open  — popup windows
//   2. fetch        — XHR-style ad requests
//   3. XMLHttpRequest — legacy XHR ad requests
//   4. MutationObserver — dynamically injected ad <script>/<iframe> nodes
function buildBlockerScript(adDomainsArray) {
  return `<script id="__binge-adblocker">(function(){
'use strict';
var D=new Set(${JSON.stringify(adDomainsArray)});
function bad(u){
  var h;
  try{h=new URL(String(u)).hostname.toLowerCase().replace(/^www\\./,'');}catch(e){return false;}
  if(D.has(h))return true;
  var p=h.split('.');
  for(var i=1;i<p.length-1;i++){if(D.has(p.slice(i).join('.')))return true;}
  return false;
}
// 1. Block popup windows entirely — the #1 mobile annoyance
window.open=function(){return null;};
// 2. Block fetch to ad domains
var oF=window.fetch;
window.fetch=function(u,opts){
  if(typeof u==='string'&&bad(u))return Promise.resolve(new Response('',{status:200}));
  return oF.apply(this,arguments);
};
// 3. Block XHR to ad domains
var oO=XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open=function(m,u){
  if(bad(u)){this.__blocked=true;return;}
  return oO.apply(this,arguments);
};
var oS=XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.send=function(){
  if(this.__blocked)return;
  return oS.apply(this,arguments);
};
// 4. Remove ad nodes injected dynamically
new MutationObserver(function(ms){
  ms.forEach(function(m){
    m.addedNodes.forEach(function(n){
      if(!n.tagName)return;
      var s=n.src||n.href||'';
      if((n.tagName==='SCRIPT'||n.tagName==='IFRAME')&&bad(s))n.remove();
    });
  });
}).observe(document.documentElement,{childList:true,subtree:true});
})();</script>`;
}

// Rewrite a URL found in the embed HTML so it loads through our resource proxy.
// Keeps same-domain relative refs absolute so cheerio can process them.
function toProxyUrl(src, base) {
  if (!src || src.startsWith('data:') || src.startsWith('blob:') || src.startsWith('javascript:')) {
    return src;
  }
  try {
    const abs = new URL(src, base).href;
    // Only rewrite http/https resources
    if (!/^https?:/.test(abs)) return src;
    return `/api/proxy?url=${encodeURIComponent(abs)}`;
  } catch {
    return src;
  }
}

// GET /api/embed-proxy?url=<encoded>
router.get('/', async (req, res) => {
  const { url } = req.query;

  if (!url) return res.status(400).send('Missing url parameter');

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).send('Invalid URL');
  }

  if (!ALLOWED_EMBED_HOSTS.has(parsed.hostname)) {
    return res.status(403).send(`Host not in allowed embed list: ${parsed.hostname}`);
  }

  try {
    const upstream = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': `${parsed.protocol}//${parsed.host}/`,
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(VERCEL ? 8_000 : 14_000),
    });

    if (!upstream.ok) {
      return res.status(upstream.status).send(`Upstream returned ${upstream.status}`);
    }

    const html = await upstream.text();
    const $ = cheerio.load(html);

    // ── 1. Set a base tag so relative resources resolve correctly ──────────
    if ($('base').length === 0) {
      $('head').prepend(`<base href="${url}">`);
    } else {
      // Resolve existing relative base href
      const existingBase = $('base').attr('href') || '';
      try {
        $('base').attr('href', new URL(existingBase, url).href);
      } catch { /* leave as-is */ }
    }

    // ── 2. Inject ad-blocker script as the very first thing in <head> ──────
    const adDomainsArray = Array.from(AD_DOMAINS);
    $('head').prepend(buildBlockerScript(adDomainsArray));

    // ── 3. Remove <script src> that load from ad domains ───────────────────
    $('script[src]').each((_, el) => {
      const src = $(el).attr('src') || '';
      try {
        const abs = new URL(src, url).href;
        if (isAdRequest(abs)) { $(el).remove(); return; }
        // Rewrite legitimate script src through resource proxy
        $(el).attr('src', toProxyUrl(src, url));
      } catch { $(el).remove(); }
    });

    // ── 4. Remove <iframe src> that point to ad domains ────────────────────
    $('iframe[src]').each((_, el) => {
      const src = $(el).attr('src') || '';
      try {
        const abs = new URL(src, url).href;
        if (isAdRequest(abs)) { $(el).remove(); return; }
        $(el).attr('src', toProxyUrl(src, url));
      } catch { $(el).remove(); }
    });

    // ── 5. Rewrite <link href> (stylesheets) through proxy ─────────────────
    $('link[rel="stylesheet"][href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      $(el).attr('href', toProxyUrl(href, url));
    });

    // ── 6. Remove obvious ad <div>/<img> by class/id heuristics ───────────
    // These match common ad container naming patterns
    $('[class*="popup"],[class*="popunder"],[class*="overlay-ad"],[id*="popupAd"]').remove();

    // ── 7. CSP would block our injected script — remove it ─────────────────
    $('meta[http-equiv="Content-Security-Policy"]').remove();

    // Allow framing from our origin
    res.set('X-Frame-Options', 'SAMEORIGIN');
    res.set('Content-Security-Policy', "frame-ancestors 'self'");
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'no-store');
    res.send($.html());

  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return res.status(504).send('Upstream timed out');
    }
    console.error('[embed-proxy] error:', err.message);
    return res.status(502).send('Could not fetch embed page');
  }
});

module.exports = router;
