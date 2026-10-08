// Opt-in web push for new-episode alerts. The subscription is stored in
// push_subscriptions (RLS: own rows); /api/cron/new-episodes sends them.
// iOS only supports this for the installed (Home Screen) app, 16.4+.
import { supabase, isSupabaseConfigured } from './supabase';
import { getActiveProfileId } from './activeProfile';

const PUBLIC_KEY = (process.env.REACT_APP_VAPID_PUBLIC_KEY || '').trim();

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

export function pushSupported() {
  return Boolean(PUBLIC_KEY && typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window);
}

export function pushPermission() {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

export async function isSubscribed() {
  if (!pushSupported()) return false;
  const registration = await navigator.serviceWorker.getRegistration();
  return Boolean(await registration?.pushManager.getSubscription());
}

export async function enableNewEpisodeAlerts() {
  if (!pushSupported()) throw new Error('Notifications aren’t supported here. On iPhone, add binge. to your Home Screen first.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications are blocked for binge. in your browser settings.');
  const registration = await navigator.serviceWorker.ready;
  const subscription = (await registration.pushManager.getSubscription())
    || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(PUBLIC_KEY) });
  const json = subscription.toJSON();
  if (!isSupabaseConfigured || !supabase) return true;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in to turn on alerts.');
  const { error } = await supabase.from('push_subscriptions').upsert({
    user_id: user.id,
    profile_id: getActiveProfileId() || null,
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
  }, { onConflict: 'endpoint' });
  if (error) throw new Error(error.message);
  return true;
}

export async function disableNewEpisodeAlerts() {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  if (supabase) await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint);
  await subscription.unsubscribe();
}
