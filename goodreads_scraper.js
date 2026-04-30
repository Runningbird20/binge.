#!/usr/bin/env node
/**
 * goodreads_scraper.js — Scrapes popular book lists from Goodreads and writes
 * them to data/goodreads_books.bulk.jsonl
 *
 * Requires: playwright (already in dependencies). Install browsers once with:
 *   npx playwright install chromium
 *
 * Usage:
 *   node goodreads_scraper.js                   # scrape all lists, 5 pages each, with details
 *   node goodreads_scraper.js --pages 3         # fewer pages per list
 *   node goodreads_scraper.js --quick           # skip book detail pages (faster, no synopsis)
 *   node goodreads_scraper.js --resume          # continue from checkpoint
 *   node goodreads_scraper.js --list-id 1       # scrape only one list (for testing)
 */

'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const DATA_DIR  = path.join(__dirname, 'data');
const OUT_FILE  = path.join(DATA_DIR, 'goodreads_books.bulk.jsonl');
const CKPT_FILE = path.join(DATA_DIR, 'goodreads.checkpoint.json');
const BASE_URL  = 'https://www.goodreads.com';

// ── CLI args ──────────────────────────────────────────────────────────────────
const args     = process.argv.slice(2);
const getArg   = (name, fallback) => { const i = args.indexOf(name); return i !== -1 && args[i + 1] ? args[i + 1] : fallback; };
const hasFlag  = (f) => args.includes(f);

const PAGES_PER_LIST   = parseInt(getArg('--pages', '5'), 10);
const FETCH_DETAILS    = !hasFlag('--quick');
const RESUME           = hasFlag('--resume');
const LIST_ID_FILTER   = getArg('--list-id', null);
const LIST_DELAY_MS    = parseInt(getArg('--delay', '1200'), 10);
const PAGE_DELAY_MS    = parseInt(getArg('--page-delay', '800'), 10);
const DETAIL_DELAY_MS  = parseInt(getArg('--detail-delay', '600'), 10);

// ── Goodreads Listopia lists to scrape ────────────────────────────────────────
// All IDs below are verified. To find more lists, browse goodreads.com/list
// and extract the numeric ID from the URL (e.g. /list/show/43 → id: '43').
const LISTS = [
  { id: '1',    genre: 'Fiction'            }, // Best Books Ever (77k+ books)
  { id: '7',    genre: 'Fiction'            }, // Best Books of the 21st Century (9847 books)
  { id: '264',  genre: 'Fiction'            }, // Books Everyone Should Read (32k+ books)
  { id: '63',   genre: 'Fiction'            }, // Favorite Books (14k+ books)
  { id: '3',    genre: 'Science Fiction'    }, // Best Science Fiction & Fantasy (86k+ books)
  { id: '50',   genre: 'Fantasy'            }, // Best Epic Fantasy (4568 books)
  { id: '51',   genre: 'Fantasy'            }, // Best Urban Fantasy (4421 books)
  { id: '43',   genre: 'Young Adult'        }, // Best Young Adult Books (13247 books)
  { id: '15',   genre: 'Historical Fiction' }, // Best Historical Fiction (7819 books)
  { id: '57',   genre: 'Romance'            }, // Best Contemporary Romance Books (4834 books)
  { id: '224',  genre: 'Romance'            }, // Favorite Historical Romance Novels (3456 books)
  { id: '135',  genre: 'Horror'             }, // Best Horror Novels (2113 books)
  { id: '11',   genre: 'Mystery'            }, // Best Crime & Mystery Books (7431 books)
  { id: '1112', genre: 'Thriller'           }, // Best Thrillers (1870 books)
  { id: '47',   genre: 'Dystopia'           }, // Best Dystopian & Post-Apocalyptic (3958 books)
  { id: '281',  genre: 'Biography'          }, // Best Memoir / Biography / Autobiography (6327 books)
  { id: '16',   genre: 'Classic Literature' }, // Best Books of the 19th Century (1749 books)
  { id: '36',   genre: 'Poetry'             }, // Best Poetry Books (3032 books)
  { id: '273',  genre: 'Self Help'          }, // Self-development (1305 books)
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function getBookId(href) {
  const m = href.match(/\/book\/show\/(\d+)/);
  return m ? m[1] : null;
}

function normalizeCoverUrl(url) {
  if (!url || url.includes('nophoto') || url.includes('nocover')) return null;
  return url
    .replace(/^http:\/\//, 'https://')
    .replace(/\._S[XY]\d+_\./, '._SX475_.')
    .replace(/\._SS\d+_\./, '._SX475_.')
    .replace(/\._CR\d+,\d+,\d+,\d+_\./, '._SX475_.');
}

function mapGenre(detailGenres, listGenre) {
  if (!detailGenres || detailGenres.length === 0) return listGenre;
  const GENRE_MAP = {
    'science fiction': 'Science Fiction', 'sci-fi': 'Science Fiction',
    'fantasy':         'Fantasy',
    'mystery':         'Mystery',         'crime':      'Mystery',
    'thriller':        'Thriller',        'suspense':   'Thriller',
    'horror':          'Horror',
    'romance':         'Romance',
    'historical fiction': 'Historical Fiction',
    'young adult':     'Young Adult',     'ya ':        'Young Adult',
    'literary fiction': 'Literary Fiction',
    'biography':       'Biography',       'memoir':     'Biography', 'autobiography': 'Biography',
    'non-fiction':     'Non-Fiction',     'nonfiction': 'Non-Fiction',
    'self-help':       'Self Help',       'self help':  'Self Help',
    'science':         'Science',
    'history':         'History',
    'classics':        'Classic Literature', 'classic literature': 'Classic Literature',
    'dystopia':        'Dystopia',
    'poetry':          'Poetry',
    'graphic novels':  'Graphic Novel',
  };
  for (const g of detailGenres) {
    const lower = g.toLowerCase();
    for (const [key, val] of Object.entries(GENRE_MAP)) {
      if (lower.includes(key)) return val;
    }
  }
  return listGenre;
}

function loadCheckpoint() {
  if (!RESUME || !fs.existsSync(CKPT_FILE)) return { doneLists: [], seenBookIds: [] };
  try { return JSON.parse(fs.readFileSync(CKPT_FILE, 'utf8')); }
  catch { return { doneLists: [], seenBookIds: [] }; }
}

function saveCheckpoint(ckpt) {
  fs.writeFileSync(CKPT_FILE, JSON.stringify(ckpt, null, 2), 'utf8');
}

function appendBooks(books) {
  if (!books.length) return;
  fs.appendFileSync(OUT_FILE, books.map((b) => JSON.stringify(b)).join('\n') + '\n', 'utf8');
}

// ── Page scrapers ─────────────────────────────────────────────────────────────

async function scrapeListPage(page, listId, pageNum) {
  const url = `${BASE_URL}/list/show/${listId}?page=${pageNum}`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (err) {
    console.error(`    ⚠ Navigation error: ${err.message}`);
    return [];
  }

  // Detect Cloudflare/bot challenge
  const bodyText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
  if (bodyText.includes('Just a moment') || bodyText.includes('Checking your browser')) {
    console.log('    ⚠ Bot challenge detected — waiting 10s and retrying...');
    await sleep(10000);
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
    } catch { return []; }
  }

  // Wait for Goodreads Listopia table (class: tableList)
  const hasRows = await page.waitForSelector('table.tableList tr[itemscope]', { timeout: 8000 }).then(() => true).catch(() => false);
  if (!hasRows) return [];

  return page.evaluate(() => {
    const results = [];
    document.querySelectorAll('table.tableList tr[itemscope]').forEach((row) => {
      const titleEl  = row.querySelector('a.bookTitle');
      const authorEl = row.querySelector('a.authorName');
      const coverEl  = row.querySelector('img.bookCover');
      if (!titleEl) return;
      results.push({
        title:    (titleEl.textContent || '').trim(),
        author:   (authorEl?.textContent || '').trim(),
        href:     titleEl.getAttribute('href') || '',
        coverUrl: coverEl?.getAttribute('src') || '',
      });
    });
    return results.filter((b) => b.title && b.href);
  });
}

async function scrapeBookDetails(page, bookUrl) {
  try {
    await page.goto(bookUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch {
    return { synopsis: '', year: null, genres: [] };
  }

  return page.evaluate(() => {
    let synopsis = '';
    let year = null;
    const genres = [];

    // ── Synopsis ──
    // New design (2022+)
    const descNew = document.querySelector('[data-testid="description"] .Formatted');
    if (descNew) {
      synopsis = descNew.innerText.trim();
    } else {
      // Old design — prefer the full hidden span over the truncated one
      const descSpans = document.querySelectorAll('#description span');
      for (const span of descSpans) {
        const text = span.innerText.trim();
        if (text.length > synopsis.length) synopsis = text;
      }
    }

    // ── Year ──
    // New design
    const pubNew = document.querySelector('[data-testid="publicationInfo"]');
    if (pubNew) {
      const m = pubNew.innerText.match(/\b(1[3-9]\d{2}|20[012]\d)\b/);
      if (m) year = parseInt(m[1], 10);
    }
    if (!year) {
      // Old design
      const detailsSection = document.querySelector('#details');
      if (detailsSection) {
        const m = detailsSection.innerText.match(/(?:Published|First published)[^\d]*(\b(?:1[3-9]\d{2}|20[012]\d)\b)/);
        if (m) year = parseInt(m[1], 10);
      }
    }
    if (!year) {
      // Meta fallback
      const metaDate = document.querySelector('meta[property="books:release_date"]');
      if (metaDate) {
        const m = metaDate.content.match(/\b(\d{4})\b/);
        if (m) year = parseInt(m[1], 10);
      }
    }

    // ── Genres ──
    // New design
    document.querySelectorAll('[data-testid="genresList"] .Button__labelItem').forEach((el) => {
      const t = el.innerText.trim();
      if (t) genres.push(t);
    });
    // Old design
    if (!genres.length) {
      document.querySelectorAll('.bookPageGenreLink').forEach((el) => {
        const t = el.innerText.trim();
        if (t) genres.push(t);
      });
    }

    return {
      synopsis: synopsis.slice(0, 1200),
      year,
      genres: genres.slice(0, 5),
    };
  }).catch(() => ({ synopsis: '', year: null, genres: [] }));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const ckpt       = loadCheckpoint();
  const doneLists  = new Set(ckpt.doneLists  || []);
  const seenIds    = new Set(ckpt.seenBookIds || []);

  if (!RESUME) {
    fs.writeFileSync(OUT_FILE, '', 'utf8');
    doneLists.clear();
    seenIds.clear();
    console.log('🗑  Cleared previous output (use --resume to append)');
  }

  const listsToRun = LIST_ID_FILTER
    ? LISTS.filter((l) => String(l.id).startsWith(LIST_ID_FILTER))
    : LISTS;

  if (!listsToRun.length) {
    console.error(`No lists matched --list-id "${LIST_ID_FILTER}"`);
    process.exit(1);
  }

  console.log(`\n📚 Goodreads scraper`);
  console.log(`   Lists: ${listsToRun.length}, pages/list: ${PAGES_PER_LIST}, fetch details: ${FETCH_DETAILS}`);
  console.log(`   Output: ${OUT_FILE}\n`);

  // Try Playwright's bundled browser; fall back to system Chrome if not installed
  const SYSTEM_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  let launchOptions = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  };
  try {
    await chromium.launch({ ...launchOptions, timeout: 5000 }).then((b) => b.close());
  } catch {
    if (fs.existsSync(SYSTEM_CHROME)) {
      console.log('ℹ  Using system Chrome (run `npx playwright install chromium` for the bundled browser)');
      launchOptions = { ...launchOptions, executablePath: SYSTEM_CHROME };
    } else {
      console.error('❌ No browser found. Run: npx playwright install chromium');
      process.exit(1);
    }
  }
  const browser = await chromium.launch(launchOptions);

  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport:  { width: 1280, height: 900 },
    locale:    'en-US',
  });

  // Block images/fonts on detail pages to speed up loading
  if (FETCH_DETAILS) {
    await ctx.route('**/*.{png,jpg,jpeg,gif,webp,woff,woff2,ttf,svg}', (route) => route.abort());
  }

  const page = await ctx.newPage();
  let totalSaved = 0;

  try {
    for (const list of listsToRun) {
      const listKey = String(list.id).split('.')[0];

      if (doneLists.has(listKey)) {
        console.log(`⏭  Skipping list ${list.id} (already done)`);
        continue;
      }

      console.log(`\n🔍 List: ${list.id}  [${list.genre}]`);

      const listBooks = [];

      for (let pg = 1; pg <= PAGES_PER_LIST; pg++) {
        process.stdout.write(`   page ${pg}/${PAGES_PER_LIST}...`);
        const pageBooks = await scrapeListPage(page, list.id, pg);

        if (!pageBooks.length) {
          console.log(' (empty, stopping)');
          break;
        }

        console.log(` ${pageBooks.length} books`);
        listBooks.push(...pageBooks);
        if (pg < PAGES_PER_LIST) await sleep(PAGE_DELAY_MS);
      }

      // Deduplicate by Goodreads book ID
      const newBooks = [];
      for (const b of listBooks) {
        const bookId = getBookId(b.href);
        if (!bookId || seenIds.has(bookId)) continue;
        seenIds.add(bookId);
        newBooks.push({ ...b, bookId });
      }

      console.log(`   ${newBooks.length} new unique books`);
      if (!newBooks.length) {
        doneLists.add(listKey);
        ckpt.doneLists  = [...doneLists];
        ckpt.seenBookIds = [...seenIds];
        saveCheckpoint(ckpt);
        continue;
      }

      // Fetch book detail pages for synopsis + year + genre
      const booksToSave = [];

      for (let i = 0; i < newBooks.length; i++) {
        const b = newBooks[i];
        const bookUrl = `${BASE_URL}/book/show/${b.bookId}`;

        let synopsis = '';
        let year = null;
        let detailGenres = [];

        if (FETCH_DETAILS) {
          if (i % 20 === 0) process.stdout.write(`\r   fetching details ${i}/${newBooks.length}...`);
          const details = await scrapeBookDetails(page, bookUrl);
          synopsis     = details.synopsis;
          year         = details.year;
          detailGenres = details.genres;
          await sleep(DETAIL_DELAY_MS);
        }

        booksToSave.push({
          sourceKey: `goodreads:${b.bookId}`,
          title:     b.title,
          author:    b.author,
          year,
          genre:     mapGenre(detailGenres, list.genre),
          synopsis:  synopsis || `${b.title} by ${b.author}.`,
          coverUrl:  normalizeCoverUrl(b.coverUrl),
          itemUrl:   bookUrl,
        });
      }

      if (FETCH_DETAILS) process.stdout.write('\r');
      appendBooks(booksToSave);
      totalSaved += booksToSave.length;
      console.log(`   ✅ saved ${booksToSave.length} books  (total: ${totalSaved})`);

      doneLists.add(listKey);
      ckpt.doneLists   = [...doneLists];
      ckpt.seenBookIds = [...seenIds];
      saveCheckpoint(ckpt);

      await sleep(LIST_DELAY_MS);
    }
  } finally {
    await browser.close();
  }

  console.log(`\n✅ Done — ${totalSaved} books written to ${OUT_FILE}`);
  if (RESUME) console.log(`   Checkpoint saved to ${CKPT_FILE}`);
}

main().catch((err) => {
  console.error('\n❌ Fatal:', err.message);
  process.exit(1);
});
