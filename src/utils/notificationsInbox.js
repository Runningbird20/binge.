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

// ── Opening a push ─────────────────────────────────────────────────────
// A push carries its inbox row's id; the service worker adds it to the link it
// opens as ?notif= (public/sw.js), and PushOpenedWatcher marks it read, then
// says so with INBOX_READ_EVENT so a bell already on screen drops the dot.
export const INBOX_LINK_PARAM = 'notif';
export const INBOX_READ_EVENT = 'binge:inbox-read';

export function inboxIdFromLink(search) {
  const value = new URLSearchParams(search || '').get(INBOX_LINK_PARAM);
  return /^\d{1,15}$/.test(value || '') ? Number(value) : null;
}

// The same address without ?notif=, the rest (play=1, season…) untouched.
export function withoutInboxId(href) {
  const url = new URL(href);
  url.searchParams.delete(INBOX_LINK_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}

// ── Realtime ───────────────────────────────────────────────────────────
// New rows (and read marks from other devices, as updates) for this account,
// through Supabase Realtime (migration 20261118130000_notifications_realtime.sql
// adds the table to its publication; RLS keeps each account to its own rows).
// onStatus gets the channel's status: 'SUBSCRIBED' when live, 'CHANNEL_ERROR',
// 'TIMED_OUT' or 'CLOSED' when not. Returns the unsubscribe.
export function subscribeToInbox(userId, { onChange, onStatus }) {
  if (!INBOX_AVAILABLE || !supabase?.channel || !userId) return () => {};
  const filter = `user_id=eq.${userId}`;
  const channel = supabase.channel(`inbox:${userId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter }, (payload) => onChange(payload.new, 'INSERT'))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notifications', filter }, (payload) => onChange(payload.new, 'UPDATE'))
    .subscribe((status) => onStatus(status));
  return () => { supabase.removeChannel(channel); };
}

// Whether a row is this profile's to see: its own, or the account's (profile_id null).
export function belongsToProfile(row, profileId) {
  return !profileId || !row?.profile_id || row.profile_id === profileId;
}
