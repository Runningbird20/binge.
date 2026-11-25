import { useEffect, useState } from 'react';
import { BellSimple, BellSimpleRinging } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { enableNewEpisodeAlerts, isSubscribed, pushPermission, pushSupported } from '../utils/pushNotifications';
import { haptic } from '../utils/haptics';
import { fetchEmailAlerts } from '../utils/emailAlerts';
import { fetchShowAlerts, saveShowAlerts } from '../utils/showAlerts';
import { useAuth } from '../contexts/AuthContext';
import EmailRemindersPrompt from './EmailRemindersPrompt';

// Push notifications are opt-in; asking right after alerts are turned on is
// the moment it makes sense. Resolves to the line for the toast.
async function pushNote(otherwise) {
  if (pushSupported() && pushPermission() !== 'denied' && !(await isSubscribed().catch(() => false))) {
    return enableNewEpisodeAlerts().then(() => 'We’ll send a notification.', () => otherwise);
  }
  return pushPermission() === 'granted' ? 'We’ll send a notification.' : otherwise;
}

// The bell in a series' title popup: one tap turns alerts on or off for its
// new episodes and newly announced seasons (utils/showAlerts.js). It's on
// already for a show on the profile's list or in its Continue Watching;
// tapping it off mutes the show, tapping it on follows any show. It rings
// while on, and swings each time it's turned on. Movies have no bell.
// An account that has never chosen about email is asked once, right after
// it turns alerts on (not on kids profiles: it's the grown-up's inbox).
export default function AlertsBell({ item }) {
  const { user, activeProfile } = useAuth() || {};
  const [following, setFollowing] = useState(null); // null until known
  const [busy, setBusy] = useState(false);
  const [swing, setSwing] = useState(0); // turned on this many times: each starts the swing again
  const [askEmail, setAskEmail] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFollowing(null);
    fetchShowAlerts(item.id).then((on) => { if (!cancelled) setFollowing(on); }).catch(() => { if (!cancelled) setFollowing(false); });
    return () => { cancelled = true; };
  }, [item.id]);

  async function toggle() {
    const next = !following;
    setFollowing(next);
    if (next) setSwing((count) => count + 1);
    setBusy(true);
    try {
      await saveShowAlerts(item.id, next);
      haptic('success');
      if (next) {
        toast(`Alerts on for ${item.title}`, { description: await pushNote('New episodes and new seasons will show up under the bell.') });
        if (!activeProfile?.is_kids && (await fetchEmailAlerts().catch(() => false)) === null) setAskEmail(true);
      } else {
        toast(`Alerts off for ${item.title}`, { description: 'Tap the bell to turn them back on.' });
      }
    } catch (error) {
      setFollowing(!next);
      toast(error.message);
    } finally {
      setBusy(false);
    }
  }

  function emailChosen(enabled) {
    setAskEmail(false);
    if (enabled) toast('Email alerts on', { description: user?.email ? `They’ll go to ${user.email}.` : undefined });
  }

  return (
    <>
      <button
        type="button"
        className={`td-round-btn${following ? ' active' : ''}`}
        onClick={toggle}
        disabled={following === null || busy}
        aria-pressed={Boolean(following)}
        aria-label="Alerts for new episodes and seasons"
        title={following ? 'Alerts on for new episodes and seasons' : 'Get alerts for new episodes and seasons'}
      >
        <span key={swing} className={`td-bell${swing ? ' td-bell--ring' : ''}`} aria-hidden="true">
          {following ? <BellSimpleRinging size={20} weight="fill" /> : <BellSimple size={20} weight="bold" />}
        </span>
      </button>
      {askEmail && <EmailRemindersPrompt email={user?.email} onClose={emailChosen} />}
    </>
  );
}
