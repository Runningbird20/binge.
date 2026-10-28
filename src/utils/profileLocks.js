import { requireSupabaseClient } from './supabase';

export async function fetchProfileLocks() {
  const client = requireSupabaseClient();
  const { data, error } = await client.rpc('list_profile_locks');
  if (!error) return { ids: new Set((data || []).map((row) => row.profile_id)), available: true };
  if (error.code === 'PGRST202') {
    // Only allow an unlocked picker when the lock storage is also absent.
    // A missing RPC alone must never bypass locks already stored in the DB.
    const { error: tableError } = await client.from('profile_locks').select('profile_id').limit(0);
    if (tableError?.code === 'PGRST205') return { ids: new Set(), available: false };
  }
  throw new Error('Unable to check profile locks. Please try again.');
}
