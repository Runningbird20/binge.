#!/usr/bin/env node
/**
 * openlibrary_scraper.js — Fetches books from Open Library and appends them
 * to data/internet_archive_books.bulk.jsonl.
 *
 * No API key needed — Open Library is free and open.
 *
 * Usage:
 *   node openlibrary_scraper.js                    # 5 pages per subject
 *   node openlibrary_scraper.js --pages 20         # more books
 *   node openlibrary_scraper.js --resume           # continue interrupted run
 */

const fs   = require('fs');
const path = require('path');

const DATA_DIR  = path.join(__dirname, 'data');
const OUT_FILE  = path.join(DATA_DIR, 'internet_archive_books.bulk.jsonl');
const CKPT_FILE = path.join(DATA_DIR, 'openlibrary.checkpoint.json');
const OL_BASE   = 'https://openlibrary.org';

// ── CLI args ──────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const getArg  = (name, fallback) => { const i = args.indexOf(name); return i !== -1 && args[i+1] ? args[i+1] : fallback; };
const hasFlag = (f) => args.includes(f);

const PAGES    = parseInt(getArg('--pages', '5'), 10);
const LIMIT    = 100; // max per request
const DELAY_MS = parseInt(getArg('--delay', '500'), 10);
const RESUME   = hasFlag('--resume');

// ── Subjects ──────────────────────────────────────────────────────────────────
const SUBJECTS = [
  { key: 'fiction',            genre: 'Fiction'            },
  { key: 'science_fiction',    genre: 'Science Fiction'    },
  { key: 'fantasy',            genre: 'Fantasy'            },
  { key: 'mystery',            genre: 'Mystery'            },
  { key: 'thriller',           genre: 'Thriller'           },
  { key: 'horror',             genre: 'Horror'             },
  { key: 'romance',            genre: 'Romance'            },
  { key: 'historical_fiction', genre: 'Historical Fiction' },
  { key: 'adventure',          genre: 'Adventure'          },
  { key: 'literary_fiction',   genre: 'Literary Fiction'   },
  { key: 'dystopian_fiction',  genre: 'Dystopia'           },
  { key: 'crime_fiction',      genre: 'Crime'              },
  { key: 'graphic_novels',     genre: 'Graphic Novel'      },
  { key: 'young_adult_fiction',genre: 'Young Adult'        },
  { key: 'biography',          genre: 'Biography'          },
  { key: 'history',            genre: 'History'            },
  { key: 'science',            genre: 'Science'            },
  { key: 'philosophy',         genre: 'Philosophy'         },
  { key: 'psychology',         genre: 'Psychology'         },
  { key: 'self_help',          genre: 'Self Help'          },
  { key: 'true_crime',         genre: 'True Crime'         },
  { key: 'technology',         genre: 'Technology'         },
  { key: 'classic_literature', genre: 'Classic Literature' },
  { key: 'mythology',          genre: 'Mythology'          },
  { key: 'poetry',             genre: 'Poetry'             },
  { key: 'short_stories',      genre: 'Short Stories'      },
  { key: 'cooking',            genre: 'Cooking'            },
  { key: 'travel',             genre: 'Travel'             },
  { key: 'art',                genre: 'Art'                },
  { key: 'music',              genre: 'Music'              },
  { key: 'sports',             genre: 'Sports'             },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function olFetch(url) {
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json', 'User-Agent': 'binge-app/1.0 (educational project)' },
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 429) {
    console.log('\n  ⏳ Rate limited — waiting 15s...');
    await sleep(15000);
    return olFetch(url);
  }
  if (!res.ok) throw new Error(`Open Library ${res.status} on ${url}`);
  return res.json();
}

// Build cover URL from Open Library cover ID
// Format: https://covers.openlibrary.org/b/id/{cover_id}-L.jpg
function buildCoverUrl(work) {
  const coverId = work.cover_id;
  if (coverId && coverId !== -1) {
    return `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`;
  }
  // Fallback: try OLID cover from the work key
  const olid = work.key?.replace('/works/', '');
  if (olid) {
    return `https://covers.openlibrary.org/b/olid/${olid}-L.jpg`;
  }
  return null;
}

// Build readable URL — Open Library embed for reading
function buildItemUrl(work) {
  if (work.key) {
    return `${OL_BASE}${work.key}`;
  }
  return null;
}

// Build readable embed URL for the reader
function buildEmbedUrl(work) {
  // Open Library read online URL
  if (work.key) {
    return `${OL_BASE}${work.key}`;
  }
  return null;
}

function extractAuthors(work) {
  const names = work.authors || work.author_name || [];
  if (!Array.isArray(names) || !names.length) return null;
  return names
    .map(a => typeof a === 'string' ? a : a?.name || '')
    .filter(Boolean)
    .slice(0, 3)
    .join(', ');
}

function extractYear(work) {
  const y = work.first_publish_year || work.first_publish_date;
  if (!y) return null;
  const match = String(y).match(/\b(1[0-9]{3}|20[0-2][0-9])\b/);
  return match ? Number(match[1]) : null;
}

function extractSynopsis(work) {
  const desc = work.description || work.first_sentence;
  if (!desc) return null;
  if (typeof desc === 'string') return desc.slice(0, 600);
  if (typeof desc?.value === 'string') return desc.value.slice(0, 600);
  return null;
}

// ── Checkpoint ────────────────────────────────────────────────────────────────

function loadCheckpoint() {
  if (!fs.existsSync(CKPT_FILE)) return { done: [], seenKeys: [] };
  try { return JSON.parse(fs.readFileSync(CKPT_FILE, 'utf8')); }
  catch { return { done: [], seenKeys: [] }; }
}

function saveCheckpoint(data) {
  fs.writeFileSync(CKPT_FILE, JSON.stringify(data, null, 2));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const checkpoint = RESUME ? loadCheckpoint() : { done: [], seenKeys: [] };
  const seenKeys   = new Set(checkpoint.seenKeys || []);

  // Load existing keys to avoid dupes
  if (fs.existsSync(OUT_FILE)) {
    console.log('📚 Loading existing book keys...');
    const lines = fs.readFileSync(OUT_FILE, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try { const r = JSON.parse(line); if (r.sourceKey) seenKeys.add(r.sourceKey); }
      catch { /* skip */ }
    }
    console.log(`   ${seenKeys.size} existing books found\n`);
  }

  const stream  = fs.createWriteStream(OUT_FILE, { flags: 'a' });
  let   written = 0;
  let   subNum  = 0;

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  🦉 Open Library Book Scraper');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Subjects: ${SUBJECTS.length}`);
  console.log(`  Pages:    ${PAGES} per subject`);
  console.log(`  Resume:   ${RESUME}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  for (const subject of SUBJECTS) {
    subNum++;

    if (RESUME && checkpoint.done?.includes(subject.key)) {
      console.log(`  ⏭  Skipping: ${subject.key}`);
      continue;
    }

    console.log(`\n[${subNum}/${SUBJECTS.length}] ${subject.key} → ${subject.genre}`);
    let subjectNew = 0;

    for (let page = 0; page < PAGES; page++) {
      const offset = page * LIMIT;
      try {
        const url  = `${OL_BASE}/subjects/${subject.key}.json?limit=${LIMIT}&offset=${offset}`;
        const data = await olFetch(url);
        const works = data.works || [];

        if (works.length === 0) { console.log(`\n  (no more results at page ${page+1})`); break; }

        for (const work of works) {
          // Build a stable source key from the Open Library work key
          const olWorkKey = work.key || '';
          const sourceKey = `internet-archive:ol${olWorkKey.replace(/\//g, '-')}`;

          if (seenKeys.has(sourceKey)) continue;
          seenKeys.add(sourceKey);

          const title    = work.title;
          if (!title) continue;

          const authors  = extractAuthors(work);
          const year     = extractYear(work);
          const synopsis = extractSynopsis(work);
          const cover    = buildCoverUrl(work);
          const itemUrl  = buildItemUrl(work);

          const record = {
            sourceKey,
            identifier: sourceKey.replace('internet-archive:', ''),
            title,
            author:      authors,
            year,
            genre:       subject.genre,
            synopsis:    synopsis || `${title}${authors ? ' by ' + authors : ''}`,
            description: synopsis,
            coverUrl:    cover,
            itemUrl,
            // Store OL work key so BookReader can embed it
            olWorkKey:   olWorkKey || null,
            subjects:    Array.isArray(work.subject) ? work.subject.slice(0, 8) : [],
          };

          stream.write(JSON.stringify(record) + '\n');
          written++;
          subjectNew++;
        }

        process.stdout.write(`\r  Page ${page+1}/${PAGES} — +${subjectNew} new this subject — ${written} total new`);
        await sleep(DELAY_MS);

      } catch (err) {
        console.error(`\n  ⚠️  Error at page ${page+1}: ${err.message}`);
        await sleep(3000);
      }
    }

    console.log('');
    checkpoint.done = [...(checkpoint.done || []), subject.key];
    checkpoint.seenKeys = Array.from(seenKeys);
    saveCheckpoint(checkpoint);
  }

  stream.end();

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  ✅ Done — ${written} new books added`);
  console.log('  🔄 Restart server to load the new data.');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main().catch(err => {
  console.error('❌ Fatal:', err.message);
  process.exit(1);
});
