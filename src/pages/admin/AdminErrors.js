import LoadingBar from '../../components/LoadingBar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../utils/supabase';
import { ago } from './AdminServers';
import { describeRequest, readableRequest } from './errorRequests';

const REQUESTS_SHOWN = 3;

// One request (server errors) or page (browser errors), summed up: method,
// what it read, and its query in short parts. Hover for the whole thing.
function RequestLine({ raw }) {
  const { method, target, details } = describeRequest(raw);
  return (
    <li className="adm-error-request" title={readableRequest(raw)}>
      {method && <span className="adm-error-method">{method}</span>}
      <span className="adm-error-target">{target}</span>
      {details.length > 0 && <span className="adm-error-details">{details.join(' · ')}</span>}
    </li>
  );
}

// binge.'s own error log, grouped by fingerprint (same message + first
// stack frame) so one bug hitting 50 people is one row.
export default function AdminErrors() {
  const [events, setEvents] = useState(null);
  const [showResolved, setShowResolved] = useState(false);
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    let query = supabase.from('error_events').select('*').gte('created_at', new Date(Date.now() - 14 * 86400000).toISOString())
      .order('created_at', { ascending: false }).limit(1000);
    if (!showResolved) query = query.eq('resolved', false);
    const { data } = await query;
    setEvents(data || []);
  }, [showResolved]);

  useEffect(() => { load(); }, [load]);

  const groups = useMemo(() => {
    const map = new Map();
    (events || []).forEach((event) => {
      const group = map.get(event.fingerprint) || { fingerprint: event.fingerprint, events: [], users: new Set(), pages: new Set() };
      group.events.push(event);
      if (event.user_id) group.users.add(event.user_id);
      if (event.url) group.pages.add(event.url);
      map.set(event.fingerprint, group);
    });
    return [...map.values()].sort((a, b) => b.events.length - a.events.length || b.events[0].created_at.localeCompare(a.events[0].created_at));
  }, [events]);

  async function resolve(fingerprint) {
    await supabase.from('error_events').update({ resolved: true }).eq('fingerprint', fingerprint);
    load();
  }

  return (
    <section className="adm-panel" aria-labelledby="adm-errors-title">
      <div className="adm-panel-head">
        <div>
          <h3 id="adm-errors-title">Errors</h3>
          <p className="adm-muted">Crashes and unexpected errors from browsers and the API, last 14 days. Embedded-player and network noise is filtered out.</p>
        </div>
        <label className="adm-check"><input type="checkbox" checked={showResolved} onChange={(event) => setShowResolved(event.target.checked)} /> Show resolved</label>
      </div>
      {!events && <LoadingBar />}
      {events && groups.length === 0 && <p className="adm-empty">No errors 🎉</p>}
      <ul className="adm-errors">
        {groups.map((group) => {
          const latest = group.events[0];
          const first = group.events[group.events.length - 1];
          const expanded = open === group.fingerprint;
          return (
            <li key={group.fingerprint} className={latest.resolved ? 'resolved' : ''}>
              <button type="button" className="adm-error-head" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : group.fingerprint)}>
                <span className={`adm-src adm-src--${latest.source}`}>{latest.source}</span>
                <span className="adm-error-msg">{latest.message}</span>
                <span className="adm-error-count">{group.events.length}×</span>
              </button>
              <p className="adm-muted adm-error-meta">
                Last {ago(latest.created_at)} · first {ago(first.created_at)} · {group.users.size} signed-in user{group.users.size === 1 ? '' : 's'}
              </p>
              {group.pages.size > 0 && (
                <ul className="adm-error-requests" aria-label={latest.source === 'server' ? 'Requests' : 'Pages'}>
                  {[...group.pages].slice(0, REQUESTS_SHOWN).map((page) => <RequestLine key={page} raw={page} />)}
                  {group.pages.size > REQUESTS_SHOWN && <li className="adm-muted">and {group.pages.size - REQUESTS_SHOWN} more</li>}
                </ul>
              )}
              {expanded && (
                <div className="adm-error-body">
                  {latest.stack && <pre>{latest.stack}</pre>}
                  {group.pages.size > 0 && <pre>{[...group.pages].map(readableRequest).join('\n\n')}</pre>}
                  {latest.user_agent && <p className="adm-muted">Browser: {latest.user_agent}</p>}
                  {!latest.resolved && <button type="button" className="st-btn st-btn--ghost" onClick={() => resolve(group.fingerprint)}>Mark resolved</button>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
