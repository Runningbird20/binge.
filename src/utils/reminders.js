// "Remind me to watch this" — stored in watch_reminders, delivered as Web
// Push by /api/cron/reminders and, whenever the app is open, in-app.
import { supabase, isSupabaseConfigured } from './supabase';
import { getActiveProfileId } from './activeProfile';

export const REMINDERS_EVENT = 'binge:reminders';

function at(date, hours, minutes = 0) {
  const next = new Date(date);
  next.setHours(hours, minutes, 0, 0);
  return next;
}

// Preset times, computed from "now" in the viewer's own timezone.
export function reminderPresets(now = new Date()) {
  const presets = [];
  const tonight = at(now, 20);
  if (tonight - now > 30 * 60 * 1000) presets.push({ id: 'tonight', label: 'Tonight at 8', when: tonight });
  else presets.push({ id: 'later', label: 'In 2 hours', when: new Date(now.getTime() + 2 * 3600 * 1000) });
  const tomorrow = at(new Date(now.getTime() + 86400000), 20);
  presets.push({ id: 'tomorrow', label: 'Tomorrow at 8', when: tomorrow });
  const saturday = new Date(now);
  saturday.setDate(now.getDate() + ((6 - now.getDay() + 7) % 7 || 7));
  presets.push({ id: 'weekend', label: 'Saturday at 11', when: at(saturday, 11) });
  return presets;
}

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

export async function createReminder({ item, mediaType, when }) {
  const userId = await currentUserId();
  if (!userId) throw new Error('Sign in to set reminders.');
  const path = mediaType === 'tv_show' ? `/tv-show/${item.id}` : mediaType === 'book' ? `/book/${item.id}` : `/movie/${item.id}`;
  const { data, error } = await supabase.from('watch_reminders').insert({
    user_id: userId,
    profile_id: getActiveProfileId(),
    media_type: mediaType,
    media_id: Number(item.id),
    title: item.title,
    url: path,
    remind_at: new Date(when).toISOString(),
  }).select().single();
  if (error) throw new Error('Couldn’t save that reminder.');
  notify();
  return data;
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
