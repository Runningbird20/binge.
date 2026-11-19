// The bell on a series (RemindButton): alerts for its new episodes and newly
// announced seasons, for the active profile. A show on the profile's list
// (not finished) or in its Continue Watching is followed already; a choice
// saved here overrides that either way: on follows any show, off mutes one
// (supabase/migrations/20261118150000_show_alerts.sql). The daily
// new-episodes job (server/routes/cron.js showFollowers) applies the same rule.
import { getAuthenticatedUser, requireSupabase, scopeToProfile } from './data/shared';
import { getActiveProfileId } from './activeProfile';
import { isSupabaseConfigured } from './supabase';

// "No such table": before the migration there are no choices, only the list rule.
const MISSING_TABLE = new Set(['PGRST205', '42P01']);

const ownChoice = (query, profileId) => (profileId ? query.eq('profile_id', profileId) : query.is('profile_id', null));

// Whether the active profile gets this show's alerts.
export async function fetchShowAlerts(mediaId) {
  if (!isSupabaseConfigured) return false;
  const client = requireSupabase();
  const user = await getAuthenticatedUser();
  const profileId = getActiveProfileId();
  const id = Number(mediaId);
  const scoped = (query) => (profileId ? scopeToProfile(query, profileId) : query);
  const [choice, listed, watching] = await Promise.all([
    ownChoice(client.from('show_alerts').select('following').eq('user_id', user.id).eq('media_id', id), profileId).maybeSingle(),
    scoped(client.from('watchlist').select('status').eq('user_id', user.id).eq('media_type', 'tv_show').eq('media_id', id)),
    scoped(client.from('continue_watching').select('id').eq('user_id', user.id).eq('media_type', 'tv_show').eq('media_id', id)),
  ]);
  if (choice.error && !MISSING_TABLE.has(choice.error.code)) throw choice.error;
  if (choice.data) return Boolean(choice.data.following);
  return (listed.data || []).some((row) => row.status !== 'watched') || (watching.data || []).length > 0;
}

// Saves the active profile's choice for this show (one row per profile and show).
export async function saveShowAlerts(mediaId, following) {
  const client = requireSupabase();
  const user = await getAuthenticatedUser();
  const profileId = getActiveProfileId();
  const id = Number(mediaId);
  const fields = { following: Boolean(following), updated_at: new Date().toISOString() };
  const { data: existing, error: readError } = await ownChoice(
    client.from('show_alerts').select('id').eq('user_id', user.id).eq('media_id', id), profileId,
  ).maybeSingle();
  if (readError) throw new Error('Couldn’t save that. Try again.');
  const { error } = existing
    ? await client.from('show_alerts').update(fields).eq('id', existing.id)
    : await client.from('show_alerts').insert({ user_id: user.id, profile_id: profileId, media_id: id, ...fields });
  if (error) throw new Error('Couldn’t save that. Try again.');
  return Boolean(following);
}
