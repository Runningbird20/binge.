// Two catalog rows can be genuinely distinct database records (different
// `id`, e.g. imported from different sources or as separate video files)
// while representing the same title to a user — the Plex importer in
// particular can create one row per file for what's really one release.
// identityKey() gives dedup helpers something sturdier than `id` to key on:
// a shared external id when we have one, else a normalized title+year (or
// title+author+year for books).
function normalizeIdentityText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function identityKey(item) {
  if (!item) return '';

  const externalId = item.imdb_id || item.imdbId || item.external_id;
  if (externalId) return `ext:${String(externalId).toLowerCase()}`;

  const title = normalizeIdentityText(item.title || item.name);
  const year = item.year ? String(item.year).slice(0, 4) : '';
  const author = normalizeIdentityText(item.author);

  return author
    ? `book:${title}|${author}|${year}`
    : `title:${title}|${year}`;
}
