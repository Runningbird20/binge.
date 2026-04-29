#!/usr/bin/env node
/**
 * clean_adult_content.js — Removes genuinely adult/inappropriate content from JSONL files.
 * Uses precise matching to avoid false positives like "The Big Lebowski", "xXx", books about Java, etc.
 *
 * Usage: node clean_adult_content.js
 */

const fs   = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');

// ── Exact title blocklist (case-insensitive) ──────────────────────────────────
// Only block titles we KNOW are adult content
const BLOCKED_EXACT_TITLES = new Set([
  // Known hentai anime
  'overflow', 'eromanga sensei', 'eromanga-sensei',
  'yosuga no sora', 'kiss x sis',
  'redo of healer', 'kaifuku jutsushi no yarinaoshi',
  'valkyrie drive: mermaid', 'valkyrie drive -mermaid-',
  'interspecies reviewers', 'ishuzoku reviewers',
  'swing out sisters',
  'joshiochi! 2-kai kara onnanoko ga... futtekita!?',
  'ikusa otome valkyrie',
  'taimanin asagi',
  'discipline: record of a crusade',
  'eroge! h mo game mo kaihatsu zanmai',
  'eroge!',
  'in the morning of la petite mort',
  'a serbian film',
  'erotic ghost story iii',
  'gabriel\'s inferno: part iii',
  // Known adult award shows
  'avn awards',
  'xbiz awards',
  'dating naked uk',
  'dating naked',
]);

// ── Title CONTAINS blocklist ──────────────────────────────────────────────────
// Only flag if these strings appear in the title (very specific phrases)
const TITLE_CONTAINS_BLOCKED = [
  'hentai',
  'pornograph',
  ' xxx ',
  '(xxx)',
  'erotic ghost story',
  'palang tod',
  'joshiochi',
  'taimanin',
];

// ── Genre exact blocklist ─────────────────────────────────────────────────────
// Flag if genre field EXACTLY contains these (not substring match)
const BLOCKED_GENRES = new Set([
  'hentai',
  'pornography',
  'adult',
  'adult animation',
]);

// ── Synopsis/overview keywords ────────────────────────────────────────────────
// Only flag if these SPECIFIC phrases appear in synopsis — not just individual words
const SYNOPSIS_PHRASES_BLOCKED = [
  'hentai',
  'pornograph',
  'sexually explicit',
  'hardcore sex',
  'softcore porn',
  'av idol',
  'jav actress',
  ' jav ',
];

// ── Age rating blocklist ──────────────────────────────────────────────────────
const BLOCKED_RATINGS = new Set(['NC-17', 'XXX', 'X-Rated', 'AO']);
// Note: we do NOT block 'X' alone — that would catch "X (the movie)" etc.

function isAdult(record) {
  const title    = (record.title || '').toLowerCase().trim();
  const genres   = (record.genre || '').toLowerCase().split(',').map(g => g.trim());
  const synopsis = (record.synopsis || record.overview || record.description || '').toLowerCase();
  const rating   = (record.ageRating || record.age_rating || '').trim();

  // 1. Exact title match
  if (BLOCKED_EXACT_TITLES.has(title)) return true;

  // 2. Title contains specific adult phrases
  if (TITLE_CONTAINS_BLOCKED.some(phrase => title.includes(phrase))) return true;

  // 3. Genre is explicitly adult
  if (genres.some(g => BLOCKED_GENRES.has(g))) return true;

  // 4. Rating is explicitly adult (only very explicit ratings, not just NC-17 alone
  //    since that catches legitimate art films in some contexts)
  if (BLOCKED_RATINGS.has(rating)) return true;

  // 5. Synopsis contains specific adult phrases
  if (SYNOPSIS_PHRASES_BLOCKED.some(phrase => synopsis.includes(phrase))) return true;

  return false;
}

async function cleanFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log(`  ${path.basename(filePath)}: not found, skipping`);
    return 0;
  }

  const lines   = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
  let   kept    = 0;
  let   removed = 0;
  const removedList = [];

  const cleaned = lines.filter(line => {
    try {
      const record = JSON.parse(line);
      if (isAdult(record)) {
        removed++;
        removedList.push(`${record.title} | rating:${record.ageRating || ''} | genre:${record.genre || ''}`);
        return false;
      }
      kept++;
      return true;
    } catch {
      kept++;
      return true;
    }
  });

  fs.writeFileSync(filePath, cleaned.join('\n') + (cleaned.length ? '\n' : ''));

  const label = path.basename(filePath);
  if (removed > 0) {
    console.log(`  ${label}: kept ${kept}, removed ${removed}`);
    removedList.forEach(t => console.log(`    🗑  ${t}`));
  } else {
    console.log(`  ${label}: kept ${kept}, nothing removed ✓`);
  }
  return removed;
}

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  🧹 Adult Content Cleaner (Precise)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const files = [
    'tmdb_movies.bulk.jsonl',
    'tmdb_tv.bulk.jsonl',
    'plex_movies.bulk.jsonl',
    'plex_tv.bulk.jsonl',
    'internet_archive_books.bulk.jsonl',
  ];

  let totalRemoved = 0;
  for (const file of files) {
    totalRemoved += await cleanFile(path.join(DATA_DIR, file));
  }

  console.log(`\n✅ Done — ${totalRemoved} adult records removed`);
  if (totalRemoved > 0) {
    console.log('   Delete server/data/app.db and restart to reload cleaned data.\n');
  } else {
    console.log('   Data is already clean.\n');
  }
}

main().catch(console.error);
