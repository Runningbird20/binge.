// Helpers shared by the Supabase user-data modules: the client guard,
// friendly errors, timeouts, profile scoping and catalog enrichment.
import { getSupabaseUser, isSupabaseConfigured, supabase } from '../supabase';
import { cacheMediaMetadata, getCachedMediaMetadata } from '../mediaMetadataCache';
import { activeProfileOwnsLegacyRows } from '../activeProfile';
import { api } from '../../api';

export const AUTH_REQUEST_TIMEOUT_MS = 8000;

export const RATING_TABLES = {
  movie: {
    table: 'movie_ratings',
    columns: ['acting', 'writing', 'originality', 'pacing', 'cinematography'],
  },
  tv_show: {
    table: 'tv_show_ratings',
    columns: ['premise', 'originality', 'acting', 'cinematography', 'writing', 'pacing', 'resonance'],
  },
  book: {
    table: 'book_ratings',
    columns: ['prose', 'plot', 'characters', 'originality', 'pacing', 'resonance'],
  },
};

const MEDIA_METADATA_TABLES = {
  movie: {
    table: 'movies',
    columns: 'id, title, year, genre, poster_url, director, source_key, original_language',
  },
  tv_show: {
    table: 'tv_shows',
    columns: 'id, title, year, genre, poster_url, creator, source_key, original_language',
  },
  book: {
    table: 'books',
    columns: 'id, title, year, genre, cover_url',
  },
};

export function requireSupabase() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured. Add your Supabase URL and publishable key first.');
  }

  return supabase;
}

export function toFriendlyError(error, fallbackMessage) {
  if (!error) {
    return fallbackMessage;
  }

  const msg = (error.message || '').toLowerCase();

  // Supabase email rate limit (free tier: 3 emails/hour)
  if (msg.includes('email rate limit') || msg.includes('rate limit exceeded') || error.status === 429) {
    return 'Too many sign-up attempts. Please wait a few minutes and try again, or contact the site admin to set up a custom email provider.';
  }

  if (error.code === '23505') {
    const detail = `${error.message || ''} ${error.details || ''}`.toLowerCase();
    if (detail.includes('username')) {
      return 'Username is already in use.';
    }
    if (detail.includes('email')) {
      return 'Email is already in use.';
    }
    if (detail.includes('watchlist')) {
      return 'Already in watchlist.';
    }
    if (detail.includes('media_id')) {
      return 'You already saved that entry.';
    }
  }

  return error.message || fallbackMessage;
}

export function withTimeout(promise, timeoutMs, timeoutMessage) {
  let timeoutId;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    window.clearTimeout(timeoutId);
  });
}

function isTimeoutError(error, timeoutMessage) {
  return error instanceof Error && error.message === timeoutMessage;
}

export async function withTimeoutRetry(promiseFactory, timeoutMs, timeoutMessage, retries = 1) {
  let attemptsRemaining = retries;

  while (true) {
    try {
      return await withTimeout(promiseFactory(), timeoutMs, timeoutMessage);
    } catch (error) {
      if (!isTimeoutError(error, timeoutMessage) || attemptsRemaining <= 0) {
        throw error;
      }

      attemptsRemaining -= 1;
      console.warn(`[auth] ${timeoutMessage} Retrying request...`);
    }
  }
}

export async function getAuthenticatedUser() {
  if (!isSupabaseConfigured || !supabase) {
    try {
      const raw = window.localStorage.getItem('user');
      if (raw) {
        const u = JSON.parse(raw);
        if (u?.id) return u;
      }
    } catch {}
    return { id: 'neon-user', email: 'user@example.com' };
  }

  const { data, error } = await withTimeout(
    getSupabaseUser(),
    AUTH_REQUEST_TIMEOUT_MS,
    'Reading the current Supabase user timed out.'
  );

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to read your Supabase session.'));
  }

  if (!data.user) {
    throw new Error('Please log in to continue.');
  }

  return data.user;
}

export function enrichMediaRecord(record, mediaType, metadata) {
  const item = metadata || null;

  return {
    ...record,
    media_type: mediaType,
    title: item?.title || `Saved ${mediaType.replace('_', ' ')}`,
    year: item?.year ?? null,
    genre: item?.genre ?? null,
    image_url: item?.image_url || null,
    director: item?.director ?? null,
    creator: item?.creator ?? null,
    source_key: item?.source_key ?? null,
    original_language: item?.original_language ?? null,
  };
}

async function fetchMediaMetadataMap(mediaType, mediaIds) {
  if (mediaIds.length === 0) {
    return new Map();
  }

  if (!isSupabaseConfigured || !supabase) {
    try {
      const endpoint = mediaType === 'tv_show' ? '/media/tv-shows' : mediaType === 'book' ? '/media/books' : '/media/movies';
      const items = await Promise.all(
        mediaIds.slice(0, 40).map(async (id) => {
          try {
            return await api.get(`${endpoint}/${id}`);
          } catch {
            return null;
          }
        })
      );
      return new Map(
        items
          .filter(Boolean)
          .map((item) => {
            const metadata = cacheMediaMetadata(mediaType, item);
            return metadata ? [metadata.id, metadata] : null;
          })
          .filter(Boolean)
      );
    } catch {
      return new Map();
    }
  }

  const client = requireSupabase();
  const schema = MEDIA_METADATA_TABLES[mediaType];
  if (!schema || mediaIds.length === 0) {
    return new Map();
  }

  const { data, error } = await client
    .from(schema.table)
    .select(schema.columns)
    .in('id', mediaIds);

  if (error) {
    return new Map();
  }

  return new Map(
    (data || [])
      .map((item) => {
        const metadata = cacheMediaMetadata(mediaType, item);
        return metadata ? [metadata.id, metadata] : null;
      })
      .filter(Boolean)
  );
}

// Reads for the active profile. The default profile (or an account's only
// profile) also owns rows saved before profiles existed or with no profile
// picked (profile_id null), the same rule the TV app uses — otherwise those
// titles show up on the TV but silently never on the website.
export function scopeToProfile(query, profileId) {
  if (!profileId) return query;
  return activeProfileOwnsLegacyRows()
    ? query.or(`profile_id.eq.${profileId},profile_id.is.null`)
    : query.eq('profile_id', profileId);
}

export async function enrichMediaRecords(records = []) {
  if (!Array.isArray(records)) {
    return [];
  }

  const pendingIdsByType = {
    movie: new Set(),
    tv_show: new Set(),
    book: new Set(),
  };

  records.forEach((record) => {
    const mediaType = record.media_type;
    const mediaId = Number(record.media_id);
    if (!MEDIA_METADATA_TABLES[mediaType] || !Number.isFinite(mediaId)) {
      return;
    }

    if (!getCachedMediaMetadata(mediaType, mediaId)) {
      pendingIdsByType[mediaType].add(mediaId);
    }
  });

  const fetchedMaps = {};
  await Promise.all(
    Object.entries(pendingIdsByType).map(async ([mediaType, pendingIds]) => {
      fetchedMaps[mediaType] = await fetchMediaMetadataMap(mediaType, [...pendingIds]);
    })
  );

  return records.map((record) => {
    const mediaType = record.media_type;
    const mediaId = Number(record.media_id);
    const metadata =
      getCachedMediaMetadata(mediaType, mediaId) ||
      fetchedMaps[mediaType]?.get(mediaId) ||
      null;

    return enrichMediaRecord(record, mediaType, metadata);
  });
}
