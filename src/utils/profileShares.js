// Household queue: one profile sends a title to another ("Mom sent you
// this"). Rows live in profile_shares, scoped to the account by RLS.
import { supabase } from './supabase';
import { getActiveProfileId } from './activeProfile';
import { enrichMediaRecords } from './supabaseData';

export async function sendToProfile({ toProfile, mediaType, mediaId, note = null }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in to send titles.');
  const { error } = await supabase.from('profile_shares').upsert({
    user_id: user.id,
    from_profile: getActiveProfileId(),
    to_profile: toProfile,
    media_type: mediaType,
    media_id: Number(mediaId),
    note: note ? String(note).slice(0, 140) : null,
    created_at: new Date().toISOString(),
    seen_at: null,
  }, { onConflict: 'to_profile,media_type,media_id' });
  if (error) throw new Error(error.message || 'Could not send that.');
}

// Titles other profiles sent to the active one, newest first, with their
// catalog details and who sent them.
export async function fetchSharedWithMe(profiles = []) {
  const me = getActiveProfileId();
  if (!me) return [];
  const { data, error } = await supabase
    .from('profile_shares')
    .select('id, from_profile, media_type, media_id, note, created_at, seen_at')
    .eq('to_profile', me)
    .order('created_at', { ascending: false })
    .limit(40);
  if (error || !data?.length) return [];
  const names = new Map(profiles.map((profile) => [profile.id, profile.name]));
  const enriched = await enrichMediaRecords(data);
  return enriched.map((row, index) => {
    const from = names.get(data[index].from_profile) || 'Someone';
    return {
      ...row,
      id: Number(row.media_id),
      _shareId: data[index].id,
      _badge: data[index].seen_at ? null : 'New',
      _subtitle: `From ${from}`,
      _reason: data[index].note ? `${from}: “${data[index].note}”` : `${from} thinks you'd like this`,
    };
  });
}

export async function markSharesSeen(ids) {
  if (!ids.length) return;
  await supabase.from('profile_shares').update({ seen_at: new Date().toISOString() }).in('id', ids).is('seen_at', null);
}

export async function removeShare(id) {
  await supabase.from('profile_shares').delete().eq('id', id);
}
