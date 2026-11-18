// Email alerts, opt-in per account and off until chosen
// (supabase/migrations/20261118140000_email_alerts.sql): reminders emailed
// when they're due, and once a day an email of new episodes and announcements
// not yet seen in binge. The server sends them (server/routes/cron.js); this
// reads and sets the account's choice. No row means it has never been asked,
// which is when setting a reminder asks (EmailRemindersPrompt).
import { getAuthenticatedUser, requireSupabase } from './data/shared';
import { isSupabaseConfigured } from './supabase';

// "No such table": the migration hasn't run, so there's nothing to offer yet.
const MISSING_TABLE = new Set(['PGRST205', '42P01']);

// true or false, or null when the account has never chosen.
export async function fetchEmailAlerts() {
  if (!isSupabaseConfigured) return false;
  const client = requireSupabase();
  const user = await getAuthenticatedUser();
  const { data, error } = await client.from('email_alerts').select('enabled').eq('user_id', user.id).maybeSingle();
  if (error) {
    if (MISSING_TABLE.has(error.code)) return false;
    throw error;
  }
  return data ? Boolean(data.enabled) : null;
}

export async function saveEmailAlerts(enabled) {
  const client = requireSupabase();
  const user = await getAuthenticatedUser();
  const { error } = await client.from('email_alerts')
    .upsert({ user_id: user.id, enabled: Boolean(enabled), updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw new Error('Couldn’t save your email setting. Try again.');
  return Boolean(enabled);
}
