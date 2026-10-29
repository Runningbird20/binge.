// Auth and account data: sign in/up/out, the account profile row, the
// account's sub-profiles, avatar uploads and the people directory.
import { getSessionlessSupabaseClient, getSupabaseSession, isSupabaseConfigured, supabase } from '../supabase';
import { resolveUserType } from '../userAccess';
import { AUTH_REQUEST_TIMEOUT_MS, getAuthenticatedUser, requireSupabase, toFriendlyError, withTimeout, withTimeoutRetry } from './shared';
import { averageRatingValue } from './library';

const PROFILE_TABLE = 'profiles';

const AUTH_MUTATION_TIMEOUT_MS = 15000;

const PROFILE_SYNC_TIMEOUT_MS = 4000;

function buildUserProfile(authUser, profileRow) {
  const email = profileRow?.email || authUser?.email || '';
  const fallbackUsername =
    profileRow?.username ||
    authUser?.user_metadata?.username ||
    (email.includes('@') ? email.split('@')[0] : 'media-fan');
  const userType = resolveUserType({
    userType: profileRow?.userType ?? authUser?.user_metadata?.userType ?? authUser?.app_metadata?.userType,
    user_type: profileRow?.user_type ?? authUser?.user_metadata?.user_type ?? authUser?.app_metadata?.user_type,
    isAdmin: profileRow?.isAdmin ?? authUser?.user_metadata?.isAdmin ?? authUser?.app_metadata?.isAdmin,
    is_admin: profileRow?.is_admin ?? authUser?.user_metadata?.is_admin ?? authUser?.app_metadata?.is_admin,
    isDev: profileRow?.isDev ?? authUser?.user_metadata?.isDev ?? authUser?.app_metadata?.isDev,
    is_dev: profileRow?.is_dev ?? authUser?.user_metadata?.is_dev ?? authUser?.app_metadata?.is_dev,
  });

  return {
    id: authUser?.id || profileRow?.id,
    username: fallbackUsername,
    email,
    bio: profileRow?.bio || authUser?.user_metadata?.bio || '',
    avatarUrl: profileRow?.avatar_url || authUser?.user_metadata?.avatar_url || null,
    createdAt: profileRow?.created_at || authUser?.created_at || null,
    userType,
    isAdmin: userType === 'admin',
    isDev: userType === 'dev',
  };
}

export function buildSupabaseUserProfile(authUser, profileRow) {
  return buildUserProfile(authUser, profileRow);
}

function buildFallbackProfileRow(authUser, overrides = {}) {
  return {
    id: authUser?.id || null,
    email: overrides.email ?? authUser?.email ?? '',
    username:
      overrides.username ??
      authUser?.user_metadata?.username ??
      (authUser?.email?.includes('@') ? authUser.email.split('@')[0] : 'media-fan'),
    bio: overrides.bio ?? authUser?.user_metadata?.bio ?? '',
    avatar_url:
      overrides.avatarUrl ??
      overrides.avatar_url ??
      authUser?.user_metadata?.avatar_url ??
      null,
    created_at: authUser?.created_at ?? null,
  };
}

async function getStoredSupabaseProfile(authUser, overrides = {}) {
  const fallbackProfile = buildUserProfile(authUser, buildFallbackProfileRow(authUser, overrides));

  if (!authUser?.id) {
    return {
      profile: fallbackProfile,
      hasStoredProfile: false,
    };
  }

  try {
    const profileRow = await withTimeout(
      getProfileRow(authUser.id),
      PROFILE_SYNC_TIMEOUT_MS,
      'Reading the Supabase profile timed out.'
    );

    if (profileRow) {
      return {
        profile: buildUserProfile(authUser, profileRow),
        hasStoredProfile: true,
      };
    }
  } catch {}

  return {
    profile: fallbackProfile,
    hasStoredProfile: false,
  };
}

// ─── Account (sub-)profiles ─────────────────────────────────────────────────
// Netflix-style profiles under one account login. Not a security boundary —
// see the migration comment in supabase/repeatable_schema.sql — so these
// just read/write account_profiles directly, scoped by account_id = auth.uid()
// the same way every other per-user table is.

export async function fetchAccountProfiles() {
  if (!isSupabaseConfigured || !supabase) {
    const rawStored = window.localStorage.getItem('neon_account_profiles');
    if (rawStored) {
      try { return JSON.parse(rawStored); } catch {}
    }
    return [
      { id: 'neon-default-profile', name: 'Main', is_default: true, is_kids: false }
    ];
  }

  const client = requireSupabase();
  const authUser = await getAuthenticatedUser();

  const { data, error } = await client
    .from('account_profiles')
    // No `pin`: a profile's lock PIN never needs to reach the browser list.
    .select('id, account_id, name, avatar_url, avatar_color, is_kids, is_default, created_at, audio_pref, subtitle_pref, settings')
    .eq('account_id', authUser.id)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to load profiles.'));
  }

  return data || [];
}

export async function createAccountProfile({ name, isKids = false, avatarUrl = null, avatarColor = null }) {
  if (!isSupabaseConfigured || !supabase) {
    const newProfile = {
      id: `profile-${Date.now()}`,
      name: name?.trim() || 'New Profile',
      is_kids: Boolean(isKids),
      avatar_url: avatarUrl,
      avatar_color: avatarColor,
      is_default: false,
      created_at: new Date().toISOString(),
    };
    const list = await fetchAccountProfiles();
    const updated = [...list, newProfile];
    window.localStorage.setItem('neon_account_profiles', JSON.stringify(updated));
    return newProfile;
  }

  const client = requireSupabase();
  const authUser = await getAuthenticatedUser();

  const { data, error } = await client
    .from('account_profiles')
    .insert({
      account_id: authUser.id,
      name: name?.trim() || 'New Profile',
      is_kids: Boolean(isKids),
      avatar_url: avatarUrl,
      avatar_color: avatarColor,
    })
    .select('id, account_id, name, avatar_url, avatar_color, is_kids, is_default, created_at')
    .single();

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to create that profile.'));
  }

  return data;
}

// `maturity` ('toddler' | 'kids' | 'teens' | 'all', see kidsMode.js) sets
// is_kids and settings.maturity together; it wins over `isKids`.
export async function updateAccountProfile(profileId, { name, isKids, maturity, avatarUrl, avatarColor } = {}) {
  if (maturity !== undefined) isKids = maturity !== 'all';
  if (!isSupabaseConfigured || !supabase) {
    const list = await fetchAccountProfiles();
    const updated = list.map((p) => {
      if (p.id !== profileId) return p;
      return {
        ...p,
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(isKids !== undefined ? { is_kids: Boolean(isKids) } : {}),
        ...(maturity !== undefined ? { settings: { ...(p.settings || {}), maturity } } : {}),
        ...(avatarUrl !== undefined ? { avatar_url: avatarUrl } : {}),
        ...(avatarColor !== undefined ? { avatar_color: avatarColor } : {}),
      };
    });
    window.localStorage.setItem('neon_account_profiles', JSON.stringify(updated));
    return;
  }

  const client = requireSupabase();

  const update = {};
  if (name !== undefined) update.name = name?.trim() || 'Profile';
  if (isKids !== undefined) update.is_kids = Boolean(isKids);
  if (avatarUrl !== undefined) update.avatar_url = avatarUrl;
  if (avatarColor !== undefined) update.avatar_color = avatarColor;
  if (maturity !== undefined) {
    // settings also holds the profile's playback switches: merge, don't replace.
    const { data: current, error: readError } = await client
      .from('account_profiles').select('settings').eq('id', profileId).single();
    if (readError) throw new Error(toFriendlyError(readError, 'Unable to update that profile.'));
    update.settings = { ...(current?.settings || {}), maturity };
  }

  const { error } = await client
    .from('account_profiles')
    .update(update)
    .eq('id', profileId);

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to update that profile.'));
  }
}

export async function deleteAccountProfile(profileId) {
  if (!isSupabaseConfigured || !supabase) {
    const list = await fetchAccountProfiles();
    const updated = list.filter((p) => p.id !== profileId || p.is_default);
    window.localStorage.setItem('neon_account_profiles', JSON.stringify(updated));
    return;
  }

  const client = requireSupabase();
  const { error } = await client
    .from('account_profiles')
    .delete()
    .eq('id', profileId)
    .eq('is_default', false); // guard rail: the default profile can't be deleted from here

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to delete that profile.'));
  }
}

async function getProfileRow(userId) {
  const client = requireSupabase();
  const { data, error } = await client
    .from(PROFILE_TABLE)
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to load your profile.'));
  }

  return data;
}

async function saveProfileRow(userId, payload, hasExistingProfile) {
  const client = requireSupabase();
  const query = hasExistingProfile
    ? client.from(PROFILE_TABLE).update(payload).eq('id', userId)
    : client.from(PROFILE_TABLE).insert({ id: userId, ...payload });

  const { data, error } = await query.select().single();

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to save your profile.'));
  }

  return data;
}

export async function ensureSupabaseProfile(authUser, overrides = {}) {
  if (!isSupabaseConfigured || !supabase) {
    return buildUserProfile(authUser, buildFallbackProfileRow(authUser, overrides));
  }

  const profileRow = await getProfileRow(authUser.id);

  const nextProfile = {
    email: overrides.email ?? profileRow?.email ?? authUser.email ?? '',
    username:
      overrides.username ??
      profileRow?.username ??
      authUser.user_metadata?.username ??
      (authUser.email?.includes('@') ? authUser.email.split('@')[0] : 'media-fan'),
    bio: overrides.bio ?? profileRow?.bio ?? authUser.user_metadata?.bio ?? '',
    avatar_url:
      overrides.avatarUrl ??
      overrides.avatar_url ??
      profileRow?.avatar_url ??
      authUser.user_metadata?.avatar_url ??
      null,
  };

  const profileNeedsWrite =
    !profileRow ||
    profileRow.email !== nextProfile.email ||
    profileRow.username !== nextProfile.username ||
    profileRow.bio !== nextProfile.bio ||
    (profileRow.avatar_url || null) !== (nextProfile.avatar_url || null);

  const savedProfile = profileNeedsWrite
    ? await saveProfileRow(authUser.id, nextProfile, Boolean(profileRow))
    : profileRow;

  return buildUserProfile(authUser, savedProfile);
}

export async function resolveSupabaseProfile(authUser, overrides = {}) {
  if (!isSupabaseConfigured || !supabase) {
    return buildUserProfile(authUser, buildFallbackProfileRow(authUser, overrides));
  }

  const { profile: fallbackProfile, hasStoredProfile } = await getStoredSupabaseProfile(authUser, overrides);

  if (hasStoredProfile) {
    void ensureSupabaseProfile(authUser, overrides).catch(() => {});
    return fallbackProfile;
  }

  try {
    return await withTimeout(
      ensureSupabaseProfile(authUser, overrides),
      PROFILE_SYNC_TIMEOUT_MS,
      'Supabase profile sync timed out.'
    );
  } catch (error) {
    console.warn('[auth] Falling back to auth metadata while profile sync is unavailable.', error);
    return fallbackProfile;
  }
}

export async function getSupabaseSessionProfile() {
  if (!isSupabaseConfigured || !supabase) {
    return null;
  }

  const { data, error } = await withTimeout(
    getSupabaseSession(),
    AUTH_REQUEST_TIMEOUT_MS,
    'Restoring the Supabase session timed out.'
  );

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to restore your session.'));
  }

  if (!data.session?.user) {
    return null;
  }

  return resolveSupabaseProfile(data.session.user);
}

export async function signInWithSupabase({ email, password }) {
  const client = requireSupabase();
  const { data, error } = await withTimeoutRetry(
    () => client.auth.signInWithPassword({ email, password }),
    AUTH_MUTATION_TIMEOUT_MS,
    'Supabase sign-in timed out.'
  );

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to log in.'));
  }

  if (!data.user) {
    throw new Error('Unable to log in.');
  }

  return resolveSupabaseProfile(data.user);
}

export async function signUpWithSupabase({ username, email, password, bio, avatarUrl }) {
  const client = requireSupabase();
  const { data, error } = await withTimeoutRetry(
    () => client.auth.signUp({
      email,
      password,
      options: {
        data: {
          username,
          bio,
          avatar_url: avatarUrl || null,
        },
      },
    }),
    AUTH_MUTATION_TIMEOUT_MS,
    'Supabase sign-up timed out.'
  );

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to create your account.'));
  }

  if (!data.user) {
    throw new Error('Unable to create your account.');
  }

  if (!data.session) {
    return {
      user: null,
      requiresEmailConfirmation: true,
    };
  }

  const user = await resolveSupabaseProfile(data.user, {
    username,
    email,
    bio,
    avatarUrl,
  });

  return {
    user,
    requiresEmailConfirmation: false,
  };
}

// Admin-initiated account creation — goes straight to Supabase Auth's public
// signUp() rather than through the server, using a session-isolated client
// so it doesn't log the admin out of their own session. Deliberately does
// NOT accept an is_admin flag here: the on_auth_user_changed trigger reads
// is_admin off client-supplied signup metadata, so honoring it from this
// call would let anyone self-grant admin via a raw signUp() call. Grant
// admin as a separate step through the server-verified toggle-admin route
// after the account exists.
export async function createSupabaseUserAsAdmin({ username, email, password, bio }) {
  const client = getSessionlessSupabaseClient();
  const { data, error } = await withTimeoutRetry(
    () => client.auth.signUp({
      email,
      password,
      options: {
        data: {
          username,
          bio: bio || '',
        },
      },
    }),
    AUTH_MUTATION_TIMEOUT_MS,
    'Supabase sign-up timed out.'
  );

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to create the account.'));
  }

  if (!data.user) {
    throw new Error('Unable to create the account.');
  }

  return {
    id: data.user.id,
    username,
    email,
    bio: bio || '',
    is_admin: false,
    is_public: true,
    created_at: data.user.created_at,
    last_sign_in_at: null,
    requiresEmailConfirmation: !data.session,
  };
}

export async function signOutFromSupabase() {
  if (!isSupabaseConfigured || !supabase) {
    return;
  }

  const client = requireSupabase();
  const { error } = await withTimeout(
    client.auth.signOut(),
    AUTH_REQUEST_TIMEOUT_MS,
    'Signing out timed out.'
  );

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to log out.'));
  }
}

export async function updateSupabaseProfile({ username, email, bio, avatarUrl }) {
  if (!isSupabaseConfigured || !supabase) {
    const raw = window.localStorage.getItem('user');
    const current = raw ? JSON.parse(raw) : {};
    const updated = {
      ...current,
      ...(username ? { username } : {}),
      ...(email ? { email } : {}),
      ...(bio !== undefined ? { bio } : {}),
      ...(avatarUrl !== undefined ? { avatarUrl } : {}),
    };
    window.localStorage.setItem('user', JSON.stringify(updated));
    return updated;
  }

  const client = requireSupabase();
  const authUser = await getAuthenticatedUser();

  const metadataUpdates = {
    username,
    bio,
    avatar_url: avatarUrl || null,
  };

  const authPayload = {};
  if (email && email !== authUser.email) {
    authPayload.email = email;
  }
  authPayload.data = metadataUpdates;

  const { data, error } = await client.auth.updateUser(authPayload);
  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to update your account.'));
  }

  return ensureSupabaseProfile(data.user || authUser, {
    username,
    email,
    bio,
    avatarUrl,
  });
}

export async function uploadSupabaseAvatar(file) {
  if (!isSupabaseConfigured || !supabase) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  const client = requireSupabase();
  const authUser = await getAuthenticatedUser();

  if (!file) throw new Error('No file provided.');
  if (!file.type.startsWith('image/')) throw new Error('File must be an image (JPEG, PNG, WebP, etc.).');
  if (file.size > 5 * 1024 * 1024) throw new Error('Image must be under 5 MB.');

  const ext = file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${authUser.id}/avatar.${ext}`;

  const { error: uploadError } = await client.storage
    .from('avatars')
    .upload(path, file, { upsert: true, contentType: file.type });

  if (uploadError) {
    if (uploadError.message?.includes('Bucket not found')) {
      throw new Error('Avatar storage is not configured. Ask an admin to create the "avatars" bucket in Supabase Storage.');
    }
    throw new Error(uploadError.message || 'Upload failed.');
  }

  const { data } = client.storage.from('avatars').getPublicUrl(path);
  // Cache-bust so the browser shows the new image immediately
  return `${data.publicUrl}?t=${Date.now()}`;
}

export async function updateSupabasePassword(newPassword) {
  if (!isSupabaseConfigured || !supabase) {
    return;
  }

  const client = requireSupabase();
  const { error } = await client.auth.updateUser({ password: newPassword });

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to update your password.'));
  }
}

export async function fetchSupabaseProfiles({ excludeUserId = null, filter = '', limit = null } = {}) {
  if (!isSupabaseConfigured || !supabase) {
    return [];
  }

  const client = requireSupabase();
  const authUser = await getAuthenticatedUser();
  let query = client.from(PROFILE_TABLE).select('id,username,bio,avatar_url,created_at').order('created_at', { ascending: false });

  if (limit != null) {
    query = query.limit(limit);
  }

  let wrappedQuery = query;
  if (excludeUserId || excludeUserId === null) {
    wrappedQuery = wrappedQuery.not('id', 'eq', excludeUserId || authUser.id);
  }

  if (filter) {
    wrappedQuery = wrappedQuery.ilike('username', `%${filter}%`);
  }

  const { data, error } = await wrappedQuery;

  if (error) {
    throw new Error(toFriendlyError(error, 'Unable to load profiles.'));
  }

  return data || [];
}

export function calculateTasteMatch(currentRatings = [], otherRatings = []) {
  const currentMap = new Map(
    currentRatings.map((rating) => [
      `${rating.media_type}:${rating.media_id}`,
      averageRatingValue(rating),
    ])
  );

  const shared = otherRatings
    .map((rating) => ({
      key: `${rating.media_type}:${rating.media_id}`,
      value: averageRatingValue(rating),
    }))
    .filter((rating) => currentMap.has(rating.key));

  if (!shared.length) {
    return 0;
  }

  const totalSimilarity = shared.reduce((sum, rating) => {
    const ownValue = currentMap.get(rating.key);
    const difference = Math.abs(ownValue - rating.value);
    return sum + Math.max(0, 1 - difference / 4);
  }, 0);

  return Math.round((totalSimilarity / shared.length) * 100);
}
