

// Library/continue-watching rows carry media_id; cards key off id.
export function asTitle(record) {
  return {
    ...record,
    id: record.media_id,
    poster_url: record.poster_url || record.image_url,
  };
}
