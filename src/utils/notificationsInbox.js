// The notification inbox: the alerts binge. sent (new episodes, reminders,
// followed-team games, admin announcements, server alerts to admins), kept 30
// days in `notifications` so the bell in the header (NotificationBell) can
// list them after the push is gone. The server writes the rows
// (server/routes/cron.js, ops.js); the app reads its own and marks them read.
import { supabase, isSupabaseConfigured } from './supabase';
import { getActiveProfileId } from './activeProfile';

export const INBOX_DAYS = 30;

// Without Supabase there's no inbox to load (the bell shows an empty one).
export const INBOX_AVAILABLE = isSupabaseConfigured;

// "No such table": the inbox's migration hasn't run yet. That's an empty
// inbox ("All caught up"), not a failed load; the console says what to apply.
const MISSING_TABLE = new Set(['PGRST205', '42P01']);
let warnedMissingTable = false;

// This profile's alerts and the account-wide ones (profile_id null), newest first.
export async function fetchNotifications({ profileId = getActiveProfileId(), now = Date.now() } = {}) {
  if (!INBOX_AVAILABLE || !supabase) return [];
  let query = supabase.from('notifications')
    .select('id, kind, title, body, url, created_at, read_at')
    .gte('created_at', new Date(now - INBOX_DAYS * 86400000).toISOString())
    .order('created_at', { ascending: false })
    .limit(100);
  if (profileId) query = query.or(`profile_id.eq.${profileId},profile_id.is.null`);
  const { data, error } = await query;
  if (error && MISSING_TABLE.has(error.code)) {
    if (!warnedMissingTable) {
      warnedMissingTable = true;
      console.warn('[inbox] Supabase has no notifications table yet: apply supabase/migrations/20261116120000_notifications_inbox.sql.');
    }
    return [];
  }
  if (error) throw error;
  return data || [];
}

export async function markNotificationsRead(ids, now = new Date()) {
  if (!ids.length || !INBOX_AVAILABLE || !supabase) return;
  const { error } = await supabase.from('notifications')
    .update({ read_at: now.toISOString() })
    .in('id', ids)
    .is('read_at', null);
  if (error) throw error;
}
