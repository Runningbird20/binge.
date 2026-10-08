import { useCallback, useEffect, useState } from 'react';
import { Trash } from '@phosphor-icons/react';
import { supabase } from '../../utils/supabase';
import { ANNOUNCEMENTS_EVENT } from '../../components/AnnouncementBanner';
import { ago } from './AdminServers';

// Site-wide banner: maintenance notices, "VidRift is down, use another
// server", new features. Shows on every page until it ends or is turned off.
export default function AdminAnnouncements() {
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState({ message: '', level: 'info', link_url: '', link_label: '', hours: '' });
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const { data } = await supabase.from('site_announcements').select('*').order('created_at', { ascending: false }).limit(30);
    setRows(data || []);
    try { window.dispatchEvent(new Event(ANNOUNCEMENTS_EVENT)); } catch { /* old browsers */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function publish(event) {
    event.preventDefault();
    const { data: { user } } = await supabase.auth.getUser();
    const hours = Number(form.hours);
    const { error } = await supabase.from('site_announcements').insert({
      message: form.message.trim(),
      level: form.level,
      link_url: form.link_url.trim() || null,
      link_label: form.link_label.trim() || null,
      ends_at: hours > 0 ? new Date(Date.now() + hours * 3600000).toISOString() : null,
      created_by: user?.id,
    });
    if (error) { setMessage(error.message); return; }
    setForm({ message: '', level: 'info', link_url: '', link_label: '', hours: '' });
    setMessage('Published — it’s live for everyone now.');
    load();
  }

  async function setActive(id, active) {
    await supabase.from('site_announcements').update({ active }).eq('id', id);
    load();
  }

  async function remove(id) {
    await supabase.from('site_announcements').delete().eq('id', id);
    load();
  }

  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  return (
    <section className="adm-panel" aria-labelledby="adm-ann-title">
      <h3 id="adm-ann-title">Announcements</h3>
      <p className="adm-muted">A banner at the top of every page.</p>
      <form className="adm-form" onSubmit={publish}>
        <label className="adm-field adm-field--wide">
          <span>Message</span>
          <textarea value={form.message} onChange={update('message')} maxLength={280} rows={2} required placeholder="Heads up: VidRift is having trouble tonight — Vidy and CineSrc are working." />
        </label>
        <label className="adm-field">
          <span>Style</span>
          <select value={form.level} onChange={update('level')}>
            <option value="info">Info (blue)</option>
            <option value="warning">Warning (amber)</option>
            <option value="critical">Critical (red)</option>
          </select>
        </label>
        <label className="adm-field">
          <span>Ends after (hours, optional)</span>
          <input type="number" min="1" max="720" value={form.hours} onChange={update('hours')} placeholder="Never" />
        </label>
        <label className="adm-field">
          <span>Link (optional)</span>
          <input type="text" value={form.link_url} onChange={update('link_url')} placeholder="/sports or https://…" />
        </label>
        <label className="adm-field">
          <span>Link text</span>
          <input type="text" value={form.link_label} onChange={update('link_label')} placeholder="Learn more" maxLength={40} />
        </label>
        <div className="adm-form-actions">
          <button type="submit" className="st-btn st-btn--primary" disabled={!form.message.trim()}>Publish</button>
          {message && <span className="adm-note" role="status">{message}</span>}
        </div>
      </form>

      <ul className="adm-ann-list">
        {(rows || []).map((row) => {
          const expired = row.ends_at && row.ends_at < new Date().toISOString();
          return (
            <li key={row.id}>
              <span className={`adm-ann-level adm-ann-level--${row.level}`}>{row.level}</span>
              <span className="adm-ann-msg">{row.message}</span>
              <span className="adm-muted">{expired ? 'ended' : row.active ? 'live' : 'off'} · {ago(row.created_at)}</span>
              <button
                type="button"
                role="switch"
                aria-checked={row.active && !expired}
                aria-label="Showing"
                className={`set-switch set-switch--sm${row.active && !expired ? ' on' : ''}`}
                onClick={() => setActive(row.id, !row.active)}
                disabled={Boolean(expired)}
              ><span /></button>
              <button type="button" className="pf-icon-btn" onClick={() => remove(row.id)} aria-label="Delete announcement"><Trash size={15} weight="bold" /></button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
