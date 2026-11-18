import { useEffect, useState } from 'react';
import { Bell, BellRinging } from '@phosphor-icons/react';
import { enableNewEpisodeAlerts, isSubscribed, pushSupported } from '../../utils/pushNotifications';

// Opt-in for push alerts when a show in your list gets a new episode.
export default function NotifyButton() {
  const [state, setState] = useState('idle'); // idle | on | busy | error
  const [message, setMessage] = useState('');
  useEffect(() => {
    let cancelled = false;
    isSubscribed().then((on) => { if (!cancelled && on) setState('on'); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  if (!pushSupported()) return null;
  if (state === 'on') {
    return <span className="st-notify st-notify--on"><BellRinging size={16} weight="fill" /> Alerts on</span>;
  }
  return (
    <span className="st-notify-wrap">
      <button
        type="button"
        className="st-btn st-btn--ghost st-notify"
        disabled={state === 'busy'}
        onClick={async () => {
          setState('busy');
          try { await enableNewEpisodeAlerts(); setState('on'); } catch (error) { setState('error'); setMessage(error.message); }
        }}
      >
        <Bell size={16} weight="bold" /> {state === 'busy' ? 'Turning on…' : 'Get notified'}
      </button>
      {state === 'error' && <span className="st-notify-error" role="status">{message}</span>}
    </span>
  );
}
