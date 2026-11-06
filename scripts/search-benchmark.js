// Search quality check for the catalog search (server/catalogSearch.js):
// runs hard queries (accents, punctuation, "the", typos) and prints the rank
// of the expected title (1 = first) and the time. At the move to Turso every
// query found its title at the same rank as Neon's old search_catalog().
//   node scripts/search-benchmark.js                  against TURSO_DATABASE_URL
//   node scripts/search-benchmark.js --db file:data/turso/catalog.db
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local'), quiet: true });
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const dbArg = process.argv.indexOf('--db');
if (dbArg > 0) process.env.TURSO_DATABASE_URL = process.argv[dbArg + 1];
const { searchCatalog } = require('../server/catalogSearch');

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
// [query, expected title (normalized compare: result title starts with it), type]
const CASES = [
  ['the dark knight', 'the dark knight', 'movie'],
  ['dark knight', 'the dark knight', 'movie'],
  ['spiderman', 'spider man', 'movie'],
  ['spider man no way home', 'spider man no way home', 'movie'],
  ['amelie', 'amelie', 'movie'],
  ['pokemon', 'pokemon', null],
  ['leon the professional', 'leon the professional', 'movie'],
  ['jojos bizarre adventure', 'jojo s bizarre adventure', 'tv'],
  ['brekaing bad', 'breaking bad', 'tv'],
  ['harry poter', 'harry potter', 'movie'],
  ['lord of the rings', 'the lord of the rings', 'movie'],
  ['office', 'the office', 'tv'],
  ['xmen', 'x men', 'movie'],
  ['walle', 'wall e', 'movie'],
  ['fast and furious', 'fast', 'movie'],
  ['avengers endgame', 'avengers endgame', 'movie'],
  ['kpop demon hunters', 'kpop demon hunters', 'movie'],
  ['up', 'up', 'movie'],
  ['her', 'her', 'movie'],
  ['dune', 'dune', null],
  ['les miserables', 'les miserables', null],
  ['shogun', 'shogun', 'tv'],
  ['mission impossible', 'mission impossible', 'movie'],
  ['pride and prejudice', 'pride and prejudice', null],
  ['tolkien', null, 'book'], // author
  ['garcia marquez', null, 'book'], // author with accents
  ['naruto shippuden', 'naruto shippuden', 'tv'],
  ['money heist', 'money heist', 'tv'],
  ['the godfather', 'the godfather', 'movie'],
  ['godfather', 'the godfather', 'movie'],
  ['stranger thigns', 'stranger things', 'tv'],
  ['gane of thrones', 'game of thrones', 'tv'],
  ['love', 'love', null],
  ['star', 'star', null],
];

function evaluate(res, expected, type) {
  // Same order the client uses: best score first, one row per id.
  const seen = new Set();
  const ranked = [...res].sort((a, b) => b.score - a.score).filter((r) => { const k = r.result_type + r.id; if (seen.has(k)) return false; seen.add(k); return true; });
  const hit = ranked.findIndex((r) => (!type || r.result_type === type) && (expected ? norm(r.title).startsWith(expected) : /tolkien|garcia marquez/.test(norm(r.author))));
  return { rank: hit < 0 ? '—' : hit + 1, top: ranked.slice(0, 3).map((r) => `${r.result_type}:${r.title}`).join(' | ').slice(0, 80) };
}

(async () => {
  const rows = [];
  for (const [q, expected, type] of CASES) {
    const t0 = Date.now();
    const result = evaluate(await searchCatalog(q, 24), expected, type);
    rows.push({ q, ms: Date.now() - t0, ...result });
  }
  for (const r of rows) console.log(`${String(r.rank).padStart(3)}  ${String(r.ms).padStart(5)}ms  ${r.q.padEnd(24)} ${r.top}`);
  const found = rows.filter((r) => r.rank !== '—');
  const total = rows.reduce((sum, r) => sum + r.ms, 0);
  console.log(`\nfound ${found.length}/${rows.length}, top-3 ${found.filter((r) => r.rank <= 3).length}, total ${total}ms, slowest ${Math.max(...rows.map((r) => r.ms))}ms`);
})();
