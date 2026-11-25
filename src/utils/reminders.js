// Reminders to watch something, stored in watch_reminders. The TV apps set
// them (the website's bell is a series' alerts switch, AlertsBell). They're
// delivered by /api/cron/reminders (push, and email with email alerts on),
// in-app while the website is open (ReminderWatcher), and listed in Settings.
import { supabase, isSupabaseConfigured } from './supabase';
import { getActiveProfileId } from './activeProfile';

export const REMINDERS_EVENT = 'binge:reminders';

export function formatReminderTime(date) {
  const d = new Date(date);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const tomorrow = d.toDateString() === new Date(now.getTime() + 86400000).toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: d.getMinutes() ? '2-digit' : undefined });
  if (sameDay) return `today at ${time}`;
  if (tomorrow) return `tomorrow at ${time}`;
  return `${d.toLocaleDateString([], { weekday: 'long' })} at ${time}`;
}

function notify() {
  try { window.dispatchEvent(new Event(REMINDERS_EVENT)); } catch { /* old browsers */ }
}

async function currentUserId() {
  if (!isSupabaseConfigured || !supabase) return null;
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id || null;
}

export async function listReminders({ dueOnly = false } = {}) {
  const userId = await currentUserId();
  if (!userId) return [];
  let query = supabase
    .from('watch_reminders')
    .select('*')
    .eq('user_id', userId)
    .is('dismissed_at', null)
    .order('remind_at', { ascending: true });
  const profileId = getActiveProfileId();
  if (profileId) query = query.eq('profile_id', profileId);
  if (dueOnly) query = query.lte('remind_at', new Date().toISOString());
  else query = query.is('sent_at', null);
  const { data } = await query;
  return data || [];
}

export async function dismissReminder(id) {
  await supabase.from('watch_reminders').update({ dismissed_at: new Date().toISOString() }).eq('id', id);
  notify();
}
