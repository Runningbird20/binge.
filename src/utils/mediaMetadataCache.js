const STORAGE_KEY = 'binge.mediaMetadata.v1';
const memoryCache = new Map();

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeYear(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function toCacheKey(mediaType, mediaId) {
  const normalizedId = Number(mediaId);
  if (!mediaType || !Number.isFinite(normalizedId)) {
    return null;
  }

  return `${mediaType}:${normalizedId}`;
}

function readStore() {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const rawValue = window.localStorage.getItem(STORAGE_KEY);
    if (!rawValue) {
      return {};
    }

    const parsedValue = JSON.parse(rawValue);
    return parsedValue && typeof parsedValue === 'object' ? parsedValue : {};
  } catch {
    return {};
  }
}

function writeStore(store) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Ignore storage quota and privacy-mode failures.
  }
}

function normalizeMediaMetadata(mediaType, item) {
  const id = Number(item?.media_id ?? item?.id);
  if (!mediaType || !Number.isFinite(id)) {
    return null;
  }

  const imageUrl = normalizeText(
    item?.image_url ||
    item?.imageUrl ||
    item?.poster_url ||
    item?.posterUrl ||
    item?.cover_url ||
    item?.coverUrl
  );

  return {
    id,
    title: normalizeText(item?.title),
    year: normalizeYear(item?.year),
    genre: normalizeText(item?.genre) || null,
    image_url: imageUrl || null,
  };
}

export function getCachedMediaMetadata(mediaType, mediaId) {
  const cacheKey = toCacheKey(mediaType, mediaId);
  if (!cacheKey) {
    return null;
  }

  if (memoryCache.has(cacheKey)) {
    return memoryCache.get(cacheKey);
  }

  const storedValue = readStore()[cacheKey] || null;
  if (storedValue) {
    memoryCache.set(cacheKey, storedValue);
  }

  return storedValue;
}

export function cacheMediaMetadata(mediaType, item) {
  const metadata = normalizeMediaMetadata(mediaType, item);
  if (!metadata) {
    return null;
  }

  const cacheKey = toCacheKey(mediaType, metadata.id);
  memoryCache.set(cacheKey, metadata);

  const store = readStore();
  store[cacheKey] = metadata;
  writeStore(store);

  return metadata;
}

export function cacheMediaMetadataList(mediaType, items = []) {
  items.forEach((item) => {
    cacheMediaMetadata(mediaType, item);
  });
}
