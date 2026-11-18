import { useEffect, useRef, useState } from 'react';
import { BellSimple, BellSimpleRinging } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { createReminder, formatReminderTime, reminderPresets } from '../utils/reminders';
import { enableNewEpisodeAlerts, isSubscribed, pushPermission, pushSupported } from '../utils/pushNotifications';
import { haptic } from '../utils/haptics';
import { fetchEmailAlerts } from '../utils/emailAlerts';
import { useAuth } from '../contexts/AuthContext';
import EmailRemindersPrompt from './EmailRemindersPrompt';

// "Remind me" — tonight / tomorrow / Saturday. Delivered as a notification
// when they're enabled, by email when the account turned that on, and in the
// app either way. An account that has never chosen about email is asked once,
// after the reminder is set (not on kids profiles: it's the grown-up's inbox).
export default function RemindButton({ item, mediaType }) {
  const { user, activeProfile } = useAuth() || {};
  const [open, setOpen] = useState(false);
  const [set, setSet] = useState(null);
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

  async function choose(preset) {
    setOpen(false);
    try {
      await createReminder({ item, mediaType, when: preset.when });
      setSet(preset.when);
      haptic('success');
      let note = 'It’ll show up in binge. when it’s time.';
      if (pushSupported() && pushPermission() !== 'denied' && !(await isSubscribed().catch(() => false))) {
        // Notifications are opt-in; asking right after they chose a time is
        // the moment it makes sense.
        await enableNewEpisodeAlerts().then(() => { note = 'We’ll send a notification.'; }).catch(() => {});
      } else if (pushPermission() === 'granted') {
        note = 'We’ll send a notification.';
      }
      toast(`Reminder set for ${formatReminderTime(preset.when)}`, { description: note });
      if (!activeProfile?.is_kids && (await fetchEmailAlerts().catch(() => false)) === null) setAskEmail(true);
    } catch (error) {
      toast(error.message);
    }
  }

  function emailChosen(enabled) {
    setAskEmail(false);
    if (enabled) toast('Email reminders on', { description: user?.email ? `They’ll go to ${user.email}.` : undefined });
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
        {set ? <BellSimpleRinging size={20} weight="fill" /> : <BellSimple size={20} weight="bold" />}
      </button>
      {open && (
        <div className="td-remind-menu" role="menu" aria-label="Remind me">
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
