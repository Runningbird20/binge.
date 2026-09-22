// Keep safe legacy IDs numeric, but never round imported PostgreSQL bigint IDs.
export function normalizeMediaId(value) {
  if (value == null || value === '') return null;
  const text = String(value);
  if (!/^\d+$/.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) ? number : text;
}
