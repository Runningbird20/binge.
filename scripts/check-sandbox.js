// npm run check:sandbox: retests every embed server's `sandbox` flag
// (src/utils/embedServers.js) the way the flags were first set (2026-11-16).
//
// Each server's real embed URL loads in an iframe on a page served from this
// machine (a non-provider origin), sandboxed with the player's own flags
// (SANDBOX_FLAGS) and not, in Chrome and in WebKit (Safari's engine), on a
// film, a 2026 film and an episode. A load counts as playing only once a
// full-length <video> (20+ minutes) in one of its frames has played 5
// seconds. What a server posts proves nothing: VidLink, VixSrc and both
// VidSrcs keep posting playback times behind their "disable the sandbox"
// page. Each load is then watched for the rest of its minute, because some
// players are replaced by ads or gates after the first seconds.
//
// A load starts with a click on the page, as the site's Play does (Chrome
// then lets the player autoplay with sound). With nothing playing after 12
// and 22 seconds the player itself is clicked, as a viewer would, and
// VidSpark also gets the site's { action: 'play' } messages. Pop-ups are
// counted and closed.
//
// Prints what each server did, and exits 1 when a server's flag disagrees
// with what was seen or the server played nowhere. The browsers are automated,
// and some players' ads notice: in Playwright's WebKit (and in Chrome given a
// user agent that contradicts it) VidRift's and Vidy's players go to ad pages
// about 11 seconds in, sandboxed or not. Real Chrome doesn't get that (checked
// 2026-11-18), so a "went to" note from WebKit says little about viewers.
//   --server vidrift,cinesrc   only these servers (ids in embedServers.js)
//   --title fight-club         only these titles (fight-club, hail-mary, got)
//   --browser chrome           chrome and/or webkit (default both), or
//                              chromium: Playwright's own build, which can't
//                              play H.264, so most streams fail in it
//   --seconds 60               how long each load is watched
//   --concurrency 4            loads at a time
//   --headed                   show the browsers
//   --json results.json        also write every load's result
// Needs Google Chrome, and Playwright's WebKit (npx playwright install webkit).

const http = require('http');
const fs = require('fs');
const { chromium, webkit } = require('@playwright/test');
const { EMBED_SERVERS, SANDBOX_FLAGS } = require('../src/utils/embedServers');

const TITLES = [
  { key: 'fight-club', name: 'Fight Club', type: 'movie', tmdb: 550 },
  { key: 'hail-mary', name: 'Project Hail Mary (2026)', type: 'movie', tmdb: 687163 },
  { key: 'got', name: 'Game of Thrones 1x1', type: 'tv_show', tmdb: 1399, season: 1, episode: 1 },
];

const FULL_LENGTH = 20 * 60; // seconds: longer than any ad
const PLAY_SECONDS = 5; // SANDBOX_PLAY_SECONDS in src/utils/popupSandbox.js
const CLICK_AFTER = [12, 22]; // seconds without playback before clicking the player
const GIVE_UP_AFTER = 40; // seconds without a full-length video at all
// The player iframe's own attributes (src/components/player/PlayerOverlays.js).
const ALLOW = 'autoplay *; fullscreen *; picture-in-picture *; encrypted-media *; web-share *';

function options(argv) {
  const out = { seconds: 60, concurrency: 4, headed: false, browsers: ['chrome', 'webkit'] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--server') out.servers = next().split(',');
    else if (arg === '--title') out.titles = next().split(',');
    else if (arg === '--browser') out.browsers = next().split(',');
    else if (arg === '--seconds') out.seconds = Number(next());
    else if (arg === '--concurrency') out.concurrency = Number(next());
    else if (arg === '--headed') out.headed = true;
    else if (arg === '--json') out.json = next();
    else throw new Error(`Unknown option ${arg}`);
  }
  return out;
}

// The page the player loads in: a Play button that adds the iframe, so the
// load starts with a real click as on the site.
function harnessPage(load) {
  const config = JSON.stringify({ src: load.url, sandbox: load.sandboxed ? SANDBOX_FLAGS : null, vidspark: load.server.id === 'vidspark' });
  return `<!doctype html><meta charset="utf-8"><title>check:sandbox</title>
<style>html,body{margin:0;height:100%;background:#000}button{position:fixed;inset:0;width:100%;font:20px system-ui}iframe{display:block;border:0;width:100vw;height:100vh}</style>
<button id="play">Play</button>
<script>
const config = ${config.replace(/</g, '\\u003c')};
document.getElementById('play').addEventListener('click', (event) => {
  event.target.remove();
  const frame = document.createElement('iframe');
  if (config.sandbox) frame.setAttribute('sandbox', config.sandbox);
  frame.setAttribute('allow', ${JSON.stringify(ALLOW)});
  frame.allowFullscreen = true;
  frame.referrerPolicy = 'no-referrer-when-downgrade';
  frame.src = config.src;
  if (config.vidspark) {
    frame.addEventListener('load', () => {
      for (const delay of [1500, 4000, 8000]) setTimeout(() => frame.contentWindow?.postMessage({ action: 'play' }, 'https://vidspark.to'), delay);
    }, { once: true });
  }
  document.body.append(frame);
});
</script>`;
}

// Every <video> in a frame, shadow roots included.
function readVideos() {
  const found = [];
  const walk = (root) => {
    root.querySelectorAll('video').forEach((video) => found.push(video));
    root.querySelectorAll('*').forEach((element) => { if (element.shadowRoot) walk(element.shadowRoot); });
  };
  walk(document);
  return found.map((video) => ({ time: video.currentTime, duration: video.duration }));
}

// Seconds of video played, counted from the first new time (which may be a
// resume point); a jump back or ahead of the clock is a seek and restarts it.
// The same rule as createPlaybackMeter in src/utils/popupSandbox.js.
function playbackMeter() {
  let first = null;
  let last = { time: 0, at: 0 };
  return (time, now) => {
    if (time > 0 && time !== last.time) {
      const seeked = first && (time < last.time || time - last.time > (now - last.at) / 1000 + 3);
      if (!first || seeked) first = { time };
      last = { time, at: now };
      return { played: last.time - first.time, moved: true };
    }
    return { played: first ? last.time - first.time : 0, moved: false };
  };
}

const hostOf = (url) => { try { return new URL(url).host; } catch { return ''; } };

async function runLoad(browser, load, base, opts) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const result = {
    server: load.server.id, title: load.title.key, browser: load.browserName, sandboxed: load.sandboxed,
    played: false, playedAfter: null, videoSeconds: 0, stillPlaying: false, popups: 0, dialogs: 0,
    tookOverTab: null, playerWentTo: [], clicks: 0, error: null,
  };
  try {
    const page = await context.newPage();
    // Any other tab is a pop-up the player opened.
    context.on('page', (popup) => { result.popups += 1; popup.close().catch(() => {}); });
    page.on('dialog', (dialog) => { result.dialogs += 1; dialog.dismiss().catch(() => {}); });
    const startHost = hostOf(load.url);
    let started = 0;
    page.on('framenavigated', (frame) => {
      const seconds = started ? Math.round((Date.now() - started) / 1000) : 0;
      if (frame === page.mainFrame()) {
        if (!frame.url().startsWith(base) && !result.tookOverTab) result.tookOverTab = { host: hostOf(frame.url()), at: seconds };
      } else if (frame.parentFrame() === page.mainFrame()) {
        const host = hostOf(frame.url());
        const lastHost = result.playerWentTo.length ? result.playerWentTo[result.playerWentTo.length - 1].host : startHost;
        if (host && host !== lastHost) result.playerWentTo.push({ host, at: seconds });
      }
    });

    await page.goto(`${base}/load/${load.id}`);
    await page.click('#play');
    started = Date.now();
    const meters = new WeakMap();
    let lastMoved = 0;
    let sawFullLength = false;
    const clicks = [...CLICK_AFTER];

    while (Date.now() - started < opts.seconds * 1000) {
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(1000);
      if (result.tookOverTab) break;
      const now = Date.now();
      const elapsed = (now - started) / 1000;
      const frames = page.frames().filter((frame) => frame !== page.mainFrame());
      // eslint-disable-next-line no-await-in-loop
      const readings = await Promise.all(frames.map((frame) => frame.evaluate(readVideos).then((videos) => [frame, videos]).catch(() => [frame, []])));
      for (const [frame, videos] of readings) {
        for (const [index, video] of videos.entries()) {
          if (!(Number.isFinite(video.duration) && video.duration >= FULL_LENGTH)) continue;
          sawFullLength = true;
          if (!meters.has(frame)) meters.set(frame, []);
          const list = meters.get(frame);
          if (!list[index]) list[index] = playbackMeter();
          const { played, moved } = list[index](video.time, now);
          if (moved) lastMoved = now;
          result.videoSeconds = Math.max(result.videoSeconds, Math.round(played));
          if (played >= PLAY_SECONDS && !result.played) {
            result.played = true;
            result.playedAfter = Math.round(elapsed);
          }
        }
      }
      if (!result.played && clicks.length && elapsed >= clicks[0]) {
        clicks.shift();
        result.clicks += 1;
        // eslint-disable-next-line no-await-in-loop
        await page.mouse.click(640, 360).catch(() => {});
      }
      if (!sawFullLength && elapsed >= GIVE_UP_AFTER) break;
    }
    result.stillPlaying = result.played && Date.now() - lastMoved < 5000;
  } catch (error) {
    result.error = error.message.split('\n')[0];
  } finally {
    await context.close().catch(() => {});
  }
  return result;
}

async function pool(tasks, size, worker) {
  const results = [];
  let next = 0;
  let done = 0;
  await Promise.all(Array.from({ length: Math.min(size, tasks.length) }, async () => {
    while (next < tasks.length) {
      const task = tasks[next++];
      // eslint-disable-next-line no-await-in-loop
      results.push(await worker(task));
      done += 1;
      process.stderr.write(`\r${done}/${tasks.length} loads`);
    }
  }));
  process.stderr.write('\n');
  return results;
}

function describe(load) {
  const notes = [];
  if (load.error) notes.push(`failed: ${load.error}`);
  if (load.tookOverTab) notes.push(`took over the whole tab (${load.tookOverTab.host}) after ${load.tookOverTab.at} s`);
  load.playerWentTo.forEach((step) => notes.push(`the player went to ${step.host} after ${step.at} s`));
  if (load.played && !load.stillPlaying) notes.push(`the video stopped after ${load.videoSeconds} s of playback`);
  if (load.popups) notes.push(`${load.popups} pop-up${load.popups === 1 ? '' : 's'}`);
  if (load.dialogs) notes.push(`${load.dialogs} alert${load.dialogs === 1 ? '' : 's'}`);
  if (load.played && load.clicks) notes.push(`played after ${load.clicks} click${load.clicks === 1 ? '' : 's'}`);
  return notes;
}

// Whether what was seen agrees with the server's flag.
function verdict(server, loads, browsers) {
  const count = (sandboxed) => loads.filter((load) => load.sandboxed === sandboxed && load.played).length;
  if (!count(true) && !count(false)) return { ok: false, text: 'Played nowhere: check it by hand, or remove it.' };
  // Per browser: did the sandbox play every title the open frame played?
  const sandboxKeepsUp = browsers.every((browser) => {
    const titles = (sandboxed) => new Set(loads.filter((load) => load.browser === browser && load.sandboxed === sandboxed && load.played).map((load) => load.title));
    const open = titles(false);
    const boxed = titles(true);
    return boxed.size > 0 && [...open].every((title) => boxed.has(title));
  });
  if (server.sandbox === true) {
    if (!count(true)) return { ok: false, text: 'Flagged sandbox: true, but it never played sandboxed: set it to false.' };
    return { ok: true, text: sandboxKeepsUp ? 'Flag agrees.' : 'Flag agrees, though the sandbox didn\'t play everything the open frame did.' };
  }
  if (sandboxKeepsUp) return { ok: false, text: 'Played sandboxed everywhere it played: it could be sandbox: true.' };
  if (count(true)) return { ok: true, text: 'Flag agrees, though it played sandboxed on some loads.' };
  return { ok: true, text: 'Flag agrees.' };
}

async function main() {
  const opts = options(process.argv.slice(2));
  const servers = EMBED_SERVERS.filter((server) => !opts.servers || opts.servers.includes(server.id));
  const titles = TITLES.filter((title) => !opts.titles || opts.titles.includes(title.key));
  if (!servers.length || !titles.length) throw new Error('No servers or titles match.');

  const loads = new Map();
  const tasks = [];
  for (const browserName of opts.browsers) {
    for (const server of servers) {
      for (const title of titles) {
        if (!server.types.includes(title.type) || !server.idKinds.includes('tmdb')) continue;
        const url = server.buildUrl({ kind: 'tmdb', value: String(title.tmdb) }, title.type, title.season || 1, title.episode || 1, null, {});
        for (const sandboxed of [true, false]) {
          const load = { id: String(tasks.length + 1), server, title, url, sandboxed, browserName };
          loads.set(load.id, load);
          tasks.push(load);
        }
      }
    }
  }

  const site = http.createServer((req, res) => {
    const load = loads.get((req.url.match(/^\/load\/(\d+)/) || [])[1]);
    if (!load) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(harnessPage(load));
  });
  await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${site.address().port}`;

  const browsers = {};
  const versions = [];
  for (const name of opts.browsers) {
    const launcher = name === 'webkit' ? webkit : chromium;
    // eslint-disable-next-line no-await-in-loop
    const browser = await launcher.launch({ headless: !opts.headed, ...(name === 'chrome' ? { channel: 'chrome' } : {}) });
    // Each browser's own user agent: VidRift's and Vidy's ads send the player
    // to ad pages ~11 s in when the user agent contradicts the browser.
    browsers[name] = browser;
    versions.push(`${name === 'webkit' ? 'WebKit' : name === 'chrome' ? 'Chrome' : 'Chromium'} ${browser.version()}`);
  }

  console.log(`Checking ${servers.length} servers on ${titles.length} titles, sandboxed and not, in ${versions.join(' and ')}: ${tasks.length} loads of up to ${opts.seconds} s.`);
  let results;
  try {
    results = await pool(tasks, opts.concurrency, (load) => runLoad(browsers[load.browserName], load, base, opts));
  } finally {
    await Promise.all(Object.values(browsers).map((browser) => browser.close().catch(() => {})));
    site.close();
  }

  let problems = 0;
  for (const server of servers) {
    const mine = results.filter((load) => load.server === server.id);
    const outcome = verdict(server, mine, opts.browsers);
    if (!outcome.ok) problems += 1;
    console.log(`\n${server.label} (${server.id}, sandbox: ${server.sandbox === true})`);
    for (const browserName of opts.browsers) {
      const of = (sandboxed) => {
        const these = mine.filter((load) => load.browser === browserName && load.sandboxed === sandboxed);
        return `${these.filter((load) => load.played).length}/${these.length}`;
      };
      console.log(`  ${browserName.padEnd(8)} sandboxed ${of(true)}, open ${of(false)}`);
    }
    console.log(`  ${outcome.ok ? '' : 'PROBLEM: '}${outcome.text}`);
    for (const load of mine) {
      const notes = describe(load);
      if (!notes.length) continue;
      const title = TITLES.find((entry) => entry.key === load.title).name;
      console.log(`    ${title}, ${load.browser}, ${load.sandboxed ? 'sandboxed' : 'open'}${load.played ? '' : ' (no playback)'}: ${notes.join('; ')}`);
    }
  }
  if (opts.json) fs.writeFileSync(opts.json, `${JSON.stringify(results, null, 2)}\n`);
  console.log(problems ? `\n${problems} server${problems === 1 ? '' : 's'} need a look.` : '\nEvery flag agrees with what played.');
  process.exitCode = problems ? 1 : 0;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
