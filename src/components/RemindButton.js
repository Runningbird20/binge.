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

// The bell in the title popup.
// - "Remind me" — tonight / tomorrow / Saturday. Delivered as a notification
//   when they're enabled, by email when the account turned that on, and in
//   the app either way. An account that has never chosen about email is
//   asked once, after the reminder is set (not on kids profiles: it's the
//   grown-up's inbox).
// - On a series, first in the menu, "New episodes & seasons": alerts when
//   episodes come out and when a new season is announced (utils/showAlerts.js).
//   On already for a show on the list or in Continue Watching; off mutes it.
//   The bell rings while either is set.
export default function RemindButton({ item, mediaType }) {
  const { user, activeProfile } = useAuth() || {};
  const isSeries = mediaType === 'tv_show';
  const [open, setOpen] = useState(false);
  const [set, setSet] = useState(null);
  const [following, setFollowing] = useState(null); // null: not known (yet)
  const [askEmail, setAskEmail] = useState(false);
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

  // Read when the popup opens and again when the menu does (My List may have
  // changed in between).
  useEffect(() => {
    if (!isSeries || (!open && following !== null)) return undefined;
    let cancelled = false;
    fetchShowAlerts(item.id).then((on) => { if (!cancelled) setFollowing(on); }).catch(() => {});
    return () => { cancelled = true; };
  }, [isSeries, item.id, open, following]);

  async function choose(preset) {
    setOpen(false);
    try {
      await createReminder({ item, mediaType, when: preset.when });
      setSet(preset.when);
      haptic('success');
      const note = await pushNote('It’ll show up in binge. when it’s time.');
      toast(`Reminder set for ${formatReminderTime(preset.when)}`, { description: note });
      if (!activeProfile?.is_kids && (await fetchEmailAlerts().catch(() => false)) === null) setAskEmail(true);
    } catch (error) {
      toast(error.message);
    }
  }

  async function toggleFollowing() {
    const next = !following;
    setOpen(false);
    setFollowing(next);
    try {
      await saveShowAlerts(item.id, next);
      haptic('success');
      if (next) toast(`Alerts on for ${item.title}`, { description: await pushNote('New episodes and new seasons will show up under the bell.') });
      else toast(`Alerts off for ${item.title}`, { description: 'Turn them back on here any time.' });
    } catch (error) {
      setFollowing(!next);
      toast(error.message);
    }
  }

  function emailChosen(enabled) {
    setAskEmail(false);
    if (enabled) toast('Email reminders on', { description: user?.email ? `They’ll go to ${user.email}.` : undefined });
  }

  const ringing = Boolean(set || following);
  const label = isSeries
    ? `Alerts and reminders${following ? ': new episodes and seasons on' : ''}${set ? `, reminder set for ${formatReminderTime(set)}` : ''}`
    : (set ? `Reminder set for ${formatReminderTime(set)}` : 'Remind me to watch');

  return (
    <div className="td-remind" ref={wrapRef}>
      <button
        type="button"
        className={`td-round-btn${ringing ? ' active' : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={isSeries ? 'Alerts and reminders' : (set ? `Reminder: ${formatReminderTime(set)}` : 'Remind me')}
      >
        {ringing ? <BellSimpleRinging size={20} weight="fill" /> : <BellSimple size={20} weight="bold" />}
      </button>
      {open && (
        <div className="td-remind-menu" role="menu" aria-label={isSeries ? 'Alerts and reminders' : 'Remind me'}>
          {isSeries && (
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={Boolean(following)}
              className="td-remind-follow"
              onClick={toggleFollowing}
              disabled={following === null}
            >
              <span className="td-remind-follow-text">
                New episodes &amp; seasons
                <small>{following ? 'You’ll get an alert' : 'Off for this show'}</small>
              </span>
              <span className={`set-switch set-switch--sm${following ? ' on' : ''}`} aria-hidden="true"><span /></span>
            </button>
          )}
          <p>Remind me to watch</p>
          {reminderPresets().map((preset) => (
            <button key={preset.id} type="button" role="menuitem" onClick={() => choose(preset)}>{preset.label}</button>
          ))}
        </div>
      )}
      {askEmail && <EmailRemindersPrompt email={user?.email} onClose={emailChosen} />}
    </div>
  );
}
