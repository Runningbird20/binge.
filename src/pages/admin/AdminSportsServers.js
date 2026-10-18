import { useCallback, useEffect, useState } from 'react';
import { ArrowClockwise } from '@phosphor-icons/react';
import { supabase } from '../../utils/supabase';
import { countFeedsBySwitch, fetchSportsFeeds, providerLabel, SPORTS_PROVIDER_IDS } from '../../utils/sportsProviders';

// Sports feeds: how many games each provider (and each Streamed source)
// carries right now, and a switch to take it out of rotation for everyone
// (website, phones and the TV apps). Same server_config table as the movie
// servers, keys prefixed "sports:".
export default function AdminSportsServers() {
  const [counts, setCounts] = useState(null);
  const [config, setConfig] = useState({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [feeds, { data: switches }] = await Promise.all([
      fetchSportsFeeds().catch(() => []),
      supabase.from('server_config').select('*').like('provider', 'sports:%'),
    ]);
    setCounts(countFeedsBySwitch(feeds));
    setConfig(Object.fromEntries((switches || []).map((row) => [row.provider, row])));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggle(key, label, enabled) {
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('server_config').upsert({ provider: key, enabled, updated_at: new Date().toISOString(), updated_by: user?.id });
    if (error) setMessage(error.message);
    else {
      setMessage(`${label} ${enabled ? 'is back in rotation' : 'is switched off for everyone'}. Viewers pick this up within a few minutes.`);
      load();
    }
  }

  // Streamed sources seen right now, plus any that were switched off (so a
  // switched-off source that's quiet today can still be turned back on).
  const sources = [...new Set([
    ...Object.keys(counts || {}), ...Object.keys(config),
  ].filter((key) => key.startsWith('sports:streamed:')))].sort();

  const rows = SPORTS_PROVIDER_IDS.flatMap((id) => {
    const parent = { key: `sports:${id}`, label: providerLabel({ id }) };
    if (id !== 'streamed') return [parent];
    return [parent, ...sources.map((key) => ({ key, label: key.slice('sports:streamed:'.length), parent: parent.key }))];
  });

  return (
    <section className="adm-panel" aria-labelledby="adm-sports-title">
      <div className="adm-panel-head">
        <div>
          <h3 id="adm-sports-title">Sports feeds</h3>
          <p className="adm-muted">Games each feed lists right now. A switched-off feed disappears from Sports, search and the TV apps; a game stays listed while another feed carries it.</p>
        </div>
        <button type="button" className="st-btn st-btn--ghost" onClick={load} disabled={loading}>
          <ArrowClockwise size={16} weight="bold" aria-hidden="true" /> {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      {message && <p className="adm-note" role="status">{message}</p>}
      {!counts && <div className="adm-skeleton skeleton-block" aria-hidden="true" />}
      {counts && (
        <table className="adm-table">
          <thead>
            <tr><th scope="col">Feed</th><th scope="col">Games listed now</th><th scope="col">In rotation</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const enabled = config[row.key]?.enabled !== false;
              const parentOff = row.parent && config[row.parent]?.enabled === false;
              return (
                <tr key={row.key} className={`${row.parent ? 'adm-subrow' : ''}${enabled && !parentOff ? '' : ' off'}`}>
                  <th scope="row">{row.parent ? `Streamed · ${row.label}` : row.label}</th>
                  <td>{counts[row.key] || 0}{parentOff && <span className="adm-muted adm-detail">off with Streamed</span>}</td>
                  <td>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={enabled}
                      aria-label={`${row.parent ? `Streamed ${row.label}` : row.label} in rotation`}
                      className={`set-switch set-switch--sm${enabled ? ' on' : ''}`}
                      onClick={() => toggle(row.key, row.parent ? `Streamed · ${row.label}` : row.label, !enabled)}
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
