import { useRef, useState } from 'react';
import { EnvelopeSimple } from '@phosphor-icons/react';
import AskDialog from './AskDialog';
import { saveEmailAlerts } from '../utils/emailAlerts';

// Asked once per account, right after its first reminder is set: email
// reminders too? "Email me" turns email alerts on (the same switch as
// Settings › Notifications). "Not now", Escape or a click outside saves no,
// so it isn't asked again. onClose(enabled) once it's settled.
export default function EmailRemindersPrompt({ email, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const yesRef = useRef(null);

  async function choose(enabled) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await saveEmailAlerts(enabled);
      onClose(enabled);
    } catch (problem) {
      // A "no" that didn't save isn't worth an error: it's asked again next time.
      if (!enabled) { onClose(false); return; }
      setError(problem.message);
      setBusy(false);
    }
  }

  return (
    <AskDialog labelledBy="ask-email-title" describedBy="ask-email-text" onDismiss={() => choose(false)} initialFocusRef={yesRef}>
      <EnvelopeSimple className="ask-icon" size={30} weight="duotone" aria-hidden="true" />
      <h2 id="ask-email-title">Email you reminders too?</h2>
      <p id="ask-email-text">
        When a reminder is due, we’ll email {email ? <strong>{email}</strong> : 'you'}. You’ll also get one email a day with new episodes and announcements you haven’t seen in binge. yet. Turn it off any time in Settings.
      </p>
      {error && <p className="ask-error" role="alert">{error}</p>}
      <div className="ask-actions">
        <button type="button" className="st-btn st-btn--primary" ref={yesRef} onClick={() => choose(true)} disabled={busy}>Email me</button>
        <button type="button" className="st-btn st-btn--ghost" onClick={() => choose(false)} disabled={busy}>Not now</button>
      </div>
    </AskDialog>
  );
}
