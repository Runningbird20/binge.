// Writes public/anime-map.json: TMDB ids to AniList ids, for the anime server
// (AniXo, which finds a show by its AniList id). The website and both TV apps
// read the same file from the site. Built from Fribb's anime-lists (MIT,
// https://github.com/Fribb/anime-lists), which maps every anime's AniList id to
// its TMDB id, the TMDB season it sits in and the episode it starts after.
//   node scripts/generate-anime-map.js public/anime-map.json
//
// Shape: { version, tv: { "<tmdb>": [[season, anilistId, offset], …] }, movie: { "<tmdb>": anilistId } }
//   season -1: no season given; the AniList entry runs the series' own episode
//   numbers (One Piece, whose TMDB seasons are numbered from the series' start
//   too). Season 0 is TMDB's specials.
//   offset: AniList episode = TMDB episode - offset (Frieren's second season sits
//   in TMDB's season 1 from episode 29: offset 28).
const fs = require('fs');

const SOURCE = 'https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json';

async function main() {
  const out = process.argv[2] || 'public/anime-map.json';
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error(`anime-lists: HTTP ${res.status}`);
  const list = await res.json();
  const tv = {};
  const movie = {};
  for (const entry of list) {
    const anilist = entry.anilist_id;
    const tmdb = entry.themoviedb_id;
    if (!anilist || !tmdb) continue;
    if (tmdb.movie && !movie[tmdb.movie]) movie[tmdb.movie] = anilist;
    if (tmdb.tv) {
      // TMDB's numbers where the list has them, else TVDB's (usually the same).
      const seasonOf = entry.season ? (entry.season.tmdb ?? entry.season.tvdb) : null;
      const season = seasonOf == null ? -1 : Number(seasonOf);
      const offset = Number(entry.episode_offset?.tmdb ?? entry.episode_offset?.tvdb) || 0;
      (tv[tmdb.tv] ||= []).push([season, anilist, offset]);
    }
  }
  // Within a season, later parts (bigger offsets) first: the first whose offset
  // is below the episode is the one it belongs to.
  for (const rows of Object.values(tv)) rows.sort((a, b) => a[0] - b[0] || b[2] - a[2]);
  const json = JSON.stringify({ version: 1, source: SOURCE, tv, movie });
  fs.writeFileSync(out, `${json}\n`);
  console.log(`${out}: ${Object.keys(tv).length} series, ${Object.keys(movie).length} films, ${(json.length / 1024).toFixed(0)} KB`);
}

main().catch((error) => { console.error(error.message); process.exit(1); });
