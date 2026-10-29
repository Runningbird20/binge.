// A viewer's session on the real site, in Chrome and Safari's engine, on a
// laptop and a phone: every main page, a show from its page to the next
// episode, and the things a person notices — errors, pages wider than the
// screen, broken images, and two videos making sound at once.
//
//   npx playwright test -c e2e/journey/journey.config.js
//   E2E_BASE_URL=http://localhost:3100 … (default: the production site)
//
// Embed players are cross-origin, but Playwright can read every frame, so
// "audible" below means a <video>/<audio> in any frame that is playing,
// unmuted, with volume up.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const SHOW = { id: 45424, name: 'Breaking Bad' }; // S1E1 is 58 minutes
const MOVIE_QUERY = 'Fight Club';
const SHOTS = path.join(__dirname, '..', '..', 'e2e-report', 'journey');
const REPORT = path.join(SHOTS, 'report.jsonl');

const PAGES = ['/', '/movies', '/tv-shows', '/books', '/sports', '/search?q=breaking%20bad', '/calendar', '/history',
  '/wrapped', '/login', '/signup', '/forgot-password', '/movie/197851', `/tv-show/${SHOW.id}`, '/does-not-exist'];

// Third-party noise that isn't ours to fix (ads blocked, trackers, embeds).
const NOISE = /favicon|ERR_BLOCKED_BY_CLIENT|ERR_NAME_NOT_RESOLVED|net::ERR_FAILED|googlesyndication|doubleclick|chrome-extension|Failed to load resource: the server responded with a status of 404|status of 403|due to access control checks|cdn-cgi|Permissions-Policy|preload but not used|third-party cookie/i;

function record(entry) {
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.appendFileSync(REPORT, JSON.stringify(entry) + '\n');
}

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && !NOISE.test(message.text())) errors.push(`console: ${message.text().slice(0, 200)}`);
  });
  page.on('requestfailed', (request) => {
    const url = request.url();
    if (url.includes(new URL(page.url() || 'http://x').host) && !NOISE.test(url)) errors.push(`request failed: ${url.slice(0, 120)} ${request.failure()?.errorText}`);
  });
  return errors;
}

// Every playing media element, frame by frame.
async function media(page) {
  const found = [];
  for (const frame of page.frames()) {
    const list = await frame.evaluate(() => Array.from(document.querySelectorAll('video, audio')).map((m) => ({
      t: Math.round(m.currentTime || 0), d: Math.round(Number.isFinite(m.duration) ? m.duration : 0),
      paused: m.paused, muted: m.muted, volume: m.volume,
    }))).catch(() => []);
    for (const m of list) found.push({ ...m, frame: frame.url().slice(0, 80), preload: !!(await frame.frameElement().then((el) => el.evaluate((node) => node.classList.contains('st-preload-frame'))).catch(() => false)) });
  }
  return found;
}

const audible = (list) => list.filter((m) => !m.paused && !m.muted && m.volume > 0 && m.t > 0);

async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${test.info().project.name}-${name}.png`) });
}

test.describe.configure({ mode: 'serial' });

test('every main page loads cleanly', async ({ page }) => {
  test.setTimeout(240_000);
  const problems = [];
  for (const route of PAGES) {
    const errors = watchErrors(page);
    const started = Date.now();
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const facts = await page.evaluate(() => {
      const wide = document.documentElement.scrollWidth - window.innerWidth;
      const broken = Array.from(document.images).filter((img) => img.complete && img.naturalWidth === 0 && img.src && !img.src.startsWith('data:'))
        .map((img) => img.src.slice(0, 100));
      const crash = /something went wrong|couldn.t load|error/i.test(document.querySelector('[role=alert], .st-problem, .error-boundary')?.textContent || '');
      return { wide, broken: broken.slice(0, 5), brokenCount: broken.length, crash, title: document.title, text: document.body.innerText.length };
    });
    const entry = { project: test.info().project.name, route, ms: Date.now() - started, url: page.url(), ...facts, errors: errors.slice(0, 6) };
    record({ check: 'page', ...entry });
    await shot(page, `page${route.replace(/[^a-z0-9]+/gi, '-')}`);
    if (facts.wide > 2) problems.push(`${route}: ${facts.wide}px wider than the screen`);
    if (facts.brokenCount) problems.push(`${route}: ${facts.brokenCount} broken images (${facts.broken[0]})`);
    if (facts.crash) problems.push(`${route}: shows an error state`);
    if (facts.text < 40) problems.push(`${route}: page is (nearly) empty`);
    if (errors.length) problems.push(`${route}: ${errors[0]}`);
  }
  expect.soft(problems, problems.join('\n')).toEqual([]);
});

test('search finds titles, typos included', async ({ page }) => {
  for (const [query, expected] of [['Breaking Bad', 'Breaking Bad'], ['breking bad', 'Breaking Bad'], ['parasite', 'Parasite'], ['Tom Hanks', 'Forrest Gump']]) {
    await page.goto(`/search?q=${encodeURIComponent(query)}`);
    const hit = page.getByText(expected, { exact: false }).first();
    const found = await hit.waitFor({ timeout: 20_000 }).then(() => true).catch(() => false);
    record({ check: 'search', project: test.info().project.name, query, found });
    expect.soft(found, `“${query}” should show ${expected}`).toBe(true);
  }
  await shot(page, 'search-tom-hanks');
});

test('a show plays with one sound, and the next episode takes over cleanly', async ({ page }) => {
  test.setTimeout(420_000);
  const errors = watchErrors(page);
  await page.goto(`/tv-show/${SHOW.id}`);
  await shot(page, 'title-page');
  const play = page.locator('.td-play').first();
  await expect(play).toBeVisible({ timeout: 30_000 });
  await play.click();

  // Playing within a minute?
  const started = Date.now();
  let playing = [];
  while (Date.now() - started < 60_000) {
    playing = (await media(page)).filter((m) => !m.paused && m.t > 0);
    if (playing.length) break;
    await page.waitForTimeout(1000);
  }
  record({ check: 'play', project: test.info().project.name, seconds: Math.round((Date.now() - started) / 1000), playing });
  await shot(page, 'playing');
  expect.soft(playing.length, 'the episode never started playing').toBeGreaterThan(0);

  // Close to the end: the Continue Watching-style ?t= link (RESUMABLE servers start there).
  await page.goto(`/tv-show/${SHOW.id}?play=1&season=1&episode=1&t=3370`);
  const timeline = [];
  let maxAudible = 0;
  let sawUpNext = false;
  let sawPreload = false;
  const until = Date.now() + 240_000;
  while (Date.now() < until) {
    const list = await media(page);
    const loud = audible(list);
    maxAudible = Math.max(maxAudible, loud.length);
    sawPreload = sawPreload || (await page.locator('.st-preload-frame').count()) > 0;
    const upNext = await page.locator('.st-upnext, [class*="upnext"], [class*="up-next"]').first().isVisible().catch(() => false);
    sawUpNext = sawUpNext || upNext;
    const episode = new URL(page.url()).searchParams.get('episode');
    timeline.push({ s: Math.round((until - Date.now()) / 1000), loud: loud.length, videos: list.length, preloadPlaying: list.filter((m) => m.preload && !m.paused).length, upNext, episode, t: loud[0]?.t ?? list[0]?.t });
    if (loud.length > 1) await shot(page, `TWO-SOUNDS-${timeline.length}`);
    if (episode === '2' && loud.length === 1) break;
    await page.waitForTimeout(2000);
  }
  record({ check: 'next-episode', project: test.info().project.name, maxAudible, sawPreload, sawUpNext, timeline, errors: errors.slice(0, 8) });
  await shot(page, 'after-next-episode');
  expect(maxAudible, 'two videos were playing sound at once').toBeLessThanOrEqual(1);
  expect.soft(timeline.some((step) => step.preloadPlaying > 0), 'the hidden next-episode frame was playing').toBe(false);
});
