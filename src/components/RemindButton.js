import { useEffect, useRef, useState } from 'react';
import { BellSimple, BellSimpleRinging } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { createReminder, formatReminderTime, reminderPresets } from '../utils/reminders';
import { enableNewEpisodeAlerts, isSubscribed, pushPermission, pushSupported } from '../utils/pushNotifications';
import { haptic } from '../utils/haptics';
import { fetchEmailAlerts } from '../utils/emailAlerts';
import { fetchShowAlerts, saveShowAlerts } from '../utils/showAlerts';
import { useAuth } from '../contexts/AuthContext';
import EmailRemindersPrompt from './EmailRemindersPrompt';

// Push notifications are opt-in; asking right after something was set up to
// alert is the moment it makes sense. Resolves to the line for the toast.
async function pushNote(otherwise) {
  if (pushSupported() && pushPermission() !== 'denied' && !(await isSubscribed().catch(() => false))) {
    return enableNewEpisodeAlerts().then(() => 'We’ll send a notification.', () => otherwise);
  }
  return pushPermission() === 'granted' ? 'We’ll send a notification.' : otherwise;
}

// The bell's icon: ringing while on, and a little swing each time it's
// turned on (`swing` counts them; a new count starts the swing again).
function BellIcon({ on, swing }) {
  return (
    <span key={swing} className={`td-bell${swing ? ' td-bell--ring' : ''}`} aria-hidden="true">
      {on ? <BellSimpleRinging size={20} weight="fill" /> : <BellSimple size={20} weight="bold" />}
    </span>
  );
}

// An account that has never chosen about email is asked once, right after
// it sets up an alert (not on kids profiles: it's the grown-up's inbox).
// → [askIfNeeded, the question while it's open]
function useEmailQuestion(about) {
  const { user, activeProfile } = useAuth() || {};
  const [asking, setAsking] = useState(false);
  async function askIfNeeded() {
    if (!activeProfile?.is_kids && (await fetchEmailAlerts().catch(() => false)) === null) setAsking(true);
  }
  const question = asking ? (
    <EmailRemindersPrompt
      about={about}
      email={user?.email}
      onClose={(enabled) => {
        setAsking(false);
        if (enabled) toast('Email reminders on', { description: user?.email ? `They’ll go to ${user.email}.` : undefined });
      }}
    />
  ) : null;
  return [askIfNeeded, question];
}

// A series: the bell is the switch for alerts when new episodes come out and
// when a new season is announced (utils/showAlerts.js). It's on already for a
// show on the profile's list or in its Continue Watching; tapping it off
// mutes the show, tapping it on follows any show. It rings while on.
function SeriesAlertsBell({ item }) {
  const [following, setFollowing] = useState(null); // null until known
  const [busy, setBusy] = useState(false);
  const [swing, setSwing] = useState(0);
  const [askEmail, emailQuestion] = useEmailQuestion('shows');

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
        await askEmail();
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

  return (
    <div className="td-remind">
      <button
        type="button"
        className={`td-round-btn${following ? ' active' : ''}`}
        onClick={toggle}
        disabled={following === null || busy}
        aria-pressed={Boolean(following)}
        aria-label="Alerts for new episodes and seasons"
        title={following ? 'Alerts on for new episodes and seasons' : 'Get alerts for new episodes and seasons'}
      >
        <BellIcon on={Boolean(following)} swing={swing} />
      </button>
      {emailQuestion}
    </div>
  );
}

// A movie: "Remind me" — tonight / tomorrow / Saturday. Delivered as a
// notification when they're enabled, by email when the account turned that
// on, and in the app either way.
function MovieReminderBell({ item, mediaType }) {
  const [open, setOpen] = useState(false);
  const [set, setSet] = useState(null);
  const [swing, setSwing] = useState(0);
  const [askEmail, emailQuestion] = useEmailQuestion('reminders');
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onDown(event) { if (!wrapRef.current?.contains(event.target)) setOpen(false); }
    function onKey(event) { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); } }
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  async function choose(preset) {
    setOpen(false);
    try {
      await createReminder({ item, mediaType, when: preset.when });
      setSet(preset.when);
      setSwing((count) => count + 1);
      haptic('success');
      toast(`Reminder set for ${formatReminderTime(preset.when)}`, { description: await pushNote('It’ll show up in binge. when it’s time.') });
      await askEmail();
    } catch (error) {
      toast(error.message);
    }
  }

  return (
    <div className="td-remind" ref={wrapRef}>
      <button
        type="button"
        className={`td-round-btn${set ? ' active' : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={set ? `Reminder set for ${formatReminderTime(set)}` : 'Remind me to watch'}
        title={set ? `Reminder: ${formatReminderTime(set)}` : 'Remind me'}
      >
        <BellIcon on={Boolean(set)} swing={swing} />
      </button>
      {open && (
        <div className="td-remind-menu" role="menu" aria-label="Remind me">
          <p>Remind me to watch</p>
          {reminderPresets().map((preset) => (
            <button key={preset.id} type="button" role="menuitem" onClick={() => choose(preset)}>{preset.label}</button>
          ))}
        </div>
      )}
      {emailQuestion}
    </div>
  );
}

// The bell in the title popup: on a series, alerts for new episodes and
// seasons; on a movie, a reminder to watch it.
export default function RemindButton({ item, mediaType }) {
  return mediaType === 'tv_show'
    ? <SeriesAlertsBell item={item} />
    : <MovieReminderBell item={item} mediaType={mediaType} />;
}
