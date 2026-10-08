import { useState } from 'react';
import { PaperPlaneTilt } from '@phosphor-icons/react';
import { api } from '../../api';

// Send a push notification to every device that has notifications on.
export default function AdminBroadcast({ deviceCount }) {
  const [form, setForm] = useState({ title: '', body: '', url: '/home' });
  const [state, setState] = useState('');
  const [confirming, setConfirming] = useState(false);
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  async function send() {
    setConfirming(false);
    setState('Sending…');
    try {
      const result = await api.post('/ops/broadcast', form);
      setState(`Sent to ${result.sent} of ${result.devices} devices${result.removed ? ` (${result.removed} expired ones cleaned up)` : ''}.`);
      setForm({ title: '', body: '', url: '/home' });
    } catch (error) {
      setState(error.message);
    }
  }

  return (
    <section className="adm-panel" aria-labelledby="adm-push-title">
      <h3 id="adm-push-title">Send a notification</h3>
      <p className="adm-muted">Goes to every device with binge. notifications on ({deviceCount ?? '…'} right now). Use sparingly.</p>
      <form className="adm-form" onSubmit={(event) => { event.preventDefault(); setConfirming(true); }}>
        <label className="adm-field adm-field--wide">
          <span>Title</span>
          <input type="text" value={form.title} onChange={update('title')} maxLength={80} required placeholder="New on binge.: Wrapped is here" />
        </label>
        <label className="adm-field adm-field--wide">
          <span>Message</span>
          <textarea value={form.body} onChange={update('body')} maxLength={200} rows={2} required placeholder="See your year in movies, shows and books." />
        </label>
        <label className="adm-field">
          <span>Opens</span>
          <input type="text" value={form.url} onChange={update('url')} pattern="/.*" title="A path on binge., like /wrapped" />
        </label>
        <div className="adm-push-preview" aria-label="Preview">
          <strong>{form.title || 'Title'}</strong>
          <span>{form.body || 'Message'}</span>
        </div>
        <div className="adm-form-actions">
          {!confirming ? (
            <button type="submit" className="st-btn st-btn--primary" disabled={!form.title.trim() || !form.body.trim()}>
              <PaperPlaneTilt size={16} weight="bold" aria-hidden="true" /> Send…
            </button>
          ) : (
            <>
              <span className="adm-note">Send to {deviceCount ?? 'all'} devices?</span>
              <button type="button" className="st-btn st-btn--primary" onClick={send}>Yes, send</button>
              <button type="button" className="st-btn st-btn--ghost" onClick={() => setConfirming(false)}>Cancel</button>
            </>
          )}
          {state && !confirming && <span className="adm-note" role="status">{state}</span>}
        </div>
      </form>
    </section>
  );
}
