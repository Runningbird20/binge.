// Search quality check for Neon's search_catalog (neon/search_catalog.sql):
// runs hard queries (accents, punctuation, "the", typos) and prints the rank
// of the expected title
// (1 = first) and the time. Usage: node scripts/search-benchmark.js [function]
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const { Pool } = require('pg');
const fn = process.argv[2] || 'search_catalog';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });
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
];
(async () => {
  const rows = [];
  let total = 0;
  for (const [q, expected, type] of CASES) {
    const t0 = Date.now();
    const { rows: res } = await pool.query(`select * from public.${fn}($1, 24)`, [q]);
    const ms = Date.now() - t0;
    total += ms;
    // Same order the client uses: best score first, one row per id.
    const seen = new Set();
    const ranked = res.sort((a, b) => b.score - a.score).filter((r) => { const k = r.result_type + r.id; if (seen.has(k)) return false; seen.add(k); return true; });
    const hit = ranked.findIndex((r) => (!type || r.result_type === type) && (expected ? norm(r.title).startsWith(expected) : /tolkien|garcia marquez/.test(norm(r.author))));
    rows.push({ q, rank: hit < 0 ? '—' : hit + 1, ms, top: ranked.slice(0, 3).map((r) => `${r.result_type}:${r.title}`).join(' | ').slice(0, 90) });
  }
  for (const r of rows) console.log(`${String(r.rank).padStart(3)}  ${String(r.ms).padStart(5)}ms  ${r.q.padEnd(24)} ${r.top}`);
  const found = rows.filter((r) => r.rank !== '—');
  console.log(`\nfound ${found.length}/${rows.length}, top-3 ${found.filter((r) => r.rank <= 3).length}, total ${total}ms, slowest ${Math.max(...rows.map((r) => r.ms))}ms`);
  await pool.end();
})();
