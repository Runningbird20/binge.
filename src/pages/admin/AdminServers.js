import { useCallback, useEffect, useState } from 'react';
import { ArrowClockwise } from '@phosphor-icons/react';
import { supabase } from '../../utils/supabase';
import { api } from '../../api';

const DOT = { up: 'green', slow: 'yellow', down: 'red', unknown: 'gray' };

export function ago(iso) {
  if (!iso) return 'never';
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

// Streaming servers: automatic status (every 15 min), viewer reports, a
// "check now" button, and a switch to take a server out of rotation for
// everyone.
export default function AdminServers() {
  const [rows, setRows] = useState(null);
  const [config, setConfig] = useState({});
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const [{ data: status }, { data: switches }] = await Promise.all([
      supabase.from('server_status').select('*').order('provider'),
      supabase.from('server_config').select('*'),
    ]);
    setRows(status || []);
    setConfig(Object.fromEntries((switches || []).map((row) => [row.provider, row])));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function checkNow() {
    setChecking(true);
    setMessage('');
    try {
      const result = await api.post('/ops/health-check');
      setMessage(result.down?.length ? `Checked ${result.checked} — down: ${result.down.join(', ')}` : `Checked ${result.checked} — all responding`);
      await load();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setChecking(false);
    }
  }

  async function toggle(provider, enabled) {
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('server_config').upsert({ provider, enabled, updated_at: new Date().toISOString(), updated_by: user?.id });
    if (error) setMessage(error.message);
    else {
      setMessage(`${provider} ${enabled ? 'is back in rotation' : 'is switched off for everyone'}.`);
      load();
    }
  }

  const lastCheck = rows?.reduce((latest, row) => (row.checked_at > latest ? row.checked_at : latest), '');

  return (
    <section className="adm-panel" aria-labelledby="adm-servers-title">
      <div className="adm-panel-head">
        <div>
          <h3 id="adm-servers-title">Streaming servers</h3>
          <p className="adm-muted">Checked automatically every 15 minutes · last {ago(lastCheck)}. Admins get a push when one goes down or recovers.</p>
        </div>
        <button type="button" className="st-btn st-btn--ghost" onClick={checkNow} disabled={checking}>
          <ArrowClockwise size={16} weight="bold" aria-hidden="true" /> {checking ? 'Checking…' : 'Check now'}
        </button>
      </div>
      {message && <p className="adm-note" role="status">{message}</p>}
      {!rows && <div className="adm-skeleton skeleton-block" aria-hidden="true" />}
      {rows?.length === 0 && <p className="adm-empty">No checks yet — press Check now.</p>}
      {rows?.length > 0 && (
        <table className="adm-table">
          <thead>
            <tr><th scope="col">Server</th><th scope="col">Status</th><th scope="col">Response</th><th scope="col">Viewers (24h)</th><th scope="col">In rotation</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const enabled = config[row.provider]?.enabled !== false;
              return (
                <tr key={row.provider} className={enabled ? '' : 'off'}>
                  <th scope="row"><span className={`admin-status-dot ${DOT[row.status] || 'gray'}`} aria-hidden="true" /> {row.label || row.provider}</th>
                  <td>
                    <span className={`adm-server-state adm-server-state--${row.status}`}>{row.status}</span>
                    <span className="adm-muted adm-detail">{row.detail || `since ${ago(row.changed_at)}`}</span>
                  </td>
                  <td>{row.latency_ms != null && row.status !== 'unknown' ? `${(row.latency_ms / 1000).toFixed(1)}s` : '—'}</td>
                  <td>{row.reports_works_24h}✓ · {row.reports_broken_24h}✗</td>
                  <td>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={enabled}
                      aria-label={`${row.label || row.provider} in rotation`}
                      className={`set-switch set-switch--sm${enabled ? ' on' : ''}`}
                      onClick={() => toggle(row.provider, !enabled)}
                    ><span /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
