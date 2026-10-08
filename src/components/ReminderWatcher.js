import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { dismissReminder, listReminders, REMINDERS_EVENT } from '../utils/reminders';

const CHECK_MS = 60_000;

// Delivers due reminders while the app is open (push covers the rest):
// a toast with "Watch now", once per reminder.
const STALE_MS = 3 * 86400000;

export default function ReminderWatcher() {
  const navigate = useNavigate();
  const location = useLocation();

  // Opened from the push notification (…?reminder=ID): it's been acted on.
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('reminder');
    if (id) dismissReminder(Number(id)).catch(() => {});
  }, [location.search]);

  useEffect(() => {
    let cancelled = false;
    const shown = new Set();

    async function check() {
      const due = await listReminders({ dueOnly: true }).catch(() => []);
      if (cancelled) return;
      due.forEach((reminder) => {
        if (shown.has(reminder.id)) return;
        if (Date.now() - new Date(reminder.remind_at).getTime() > STALE_MS) {
          dismissReminder(reminder.id).catch(() => {});
          return;
        }
        shown.add(reminder.id);
        toast(`Time to watch ${reminder.title}`, {
          description: 'You asked binge. to remind you.',
          duration: Infinity,
          action: {
            label: 'Watch now',
            onClick: () => {
              dismissReminder(reminder.id);
              navigate(`${reminder.url}?play=1`);
            },
          },
          cancel: { label: 'Dismiss', onClick: () => dismissReminder(reminder.id) },
        });
      });
    }

    check();
    const timer = setInterval(check, CHECK_MS);
    window.addEventListener(REMINDERS_EVENT, check);
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener(REMINDERS_EVENT, check);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [navigate]);

  return null;
}
