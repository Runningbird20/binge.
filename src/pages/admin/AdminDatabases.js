import { useCallback, useEffect, useState } from 'react';
import { ArrowClockwise, WarningCircle } from '@phosphor-icons/react';
import LoadingBar from '../../components/LoadingBar';
import { api } from '../../api';
import { timeAgo } from '../../utils/timeAgo';

const DOT = { up: 'green', slow: 'yellow', down: 'red' };
const STATE = { up: 'Healthy', slow: 'Slow', down: 'Down' };

const MB = 1024 ** 2;
const GB = 1024 ** 3;
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

export function formatBytes(bytes) {
  if (bytes == null) return '—';
  if (bytes < MB) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < GB) return `${(bytes / MB).toFixed(bytes < 10 * MB ? 1 : 0)} MB`;
  return `${(bytes / GB).toFixed(1).replace(/\.0$/, '')} GB`;
}

const formatCount = (count) => (count == null ? '—' : compact.format(count));
const formatPercent = (share) => `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`;
const formatMs = (ms) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

// Admin → Databases: whether Supabase and Turso answer, how fast, and how
// full each is against its plan (server/utils/databaseHealth.js). Checked
// when the tab opens and on Check again.
export default function AdminDatabases() {
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(true);

  const runCheck = useCallback(async () => {
    setChecking(true);
    setError('');
    try {
      setReport(await api.get('/ops/databases'));
    } catch (failure) {
      setError(failure?.message || 'No answer from the server.');
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => { runCheck(); }, [runCheck]);

  return (
    <>
      <section className="adm-panel adm-db-intro" aria-labelledby="adm-db-title">
        <div className="adm-panel-head">
          <div>
            <h3 id="adm-db-title">Databases</h3>
            <p className="adm-muted">
              Supabase holds accounts and everything people save; Turso holds the movie, series and book catalog.
              {report && ` Checked ${timeAgo(report.checkedAt)}.`}
            </p>
          </div>
          <button type="button" className="st-btn st-btn--ghost" onClick={runCheck} disabled={checking}>
            <ArrowClockwise size={16} weight="bold" aria-hidden="true" /> {checking ? 'Checking…' : 'Check again'}
          </button>
        </div>
        {error && <p className="adm-note" role="alert">Couldn’t check the databases: {error}</p>}
        {!report && !error && <LoadingBar label="Checking both databases…" />}
      </section>
      {report && (
        <>
          <DatabasePanel id="supabase" name="Supabase" about="Accounts, profiles, lists, ratings and history" report={report.supabase}>
            {report.supabase.tables.length > 0 && <LargestTables tables={report.supabase.tables} />}
          </DatabasePanel>
          <DatabasePanel id="turso" name="Turso" about="The movie, series and book catalog" report={report.turso}>
            {report.turso.rows.length > 0 && <CatalogRows rows={report.turso.rows} />}
          </DatabasePanel>
        </>
      )}
    </>
  );
}

function DatabasePanel({ id, name, about, report, children }) {
  const plan = `${report.plan.label} plan${report.plan.source === 'default' ? ' (assumed)' : ''}`;
  return (
    <section className="adm-panel adm-db" aria-labelledby={`adm-db-${id}`}>
      <h3 id={`adm-db-${id}`} className="adm-db-name">
        <span className={`admin-status-dot ${DOT[report.status]}`} aria-hidden="true" />
        {name}
        <span className={`adm-server-state adm-server-state--${report.status}`}>{STATE[report.status]}</span>
      </h3>
      <p className="adm-muted">{about} · {plan}{report.host ? ` · ${report.host}` : ''}</p>

      <table className="adm-table adm-db-checks">
        <thead>
          <tr><th scope="col">Check</th><th scope="col">Status</th><th scope="col">Response</th><th scope="col">Detail</th></tr>
        </thead>
        <tbody>
          {report.checks.map((entry) => (
            <tr key={entry.id}>
              <th scope="row"><span className={`admin-status-dot ${DOT[entry.status]}`} aria-hidden="true" /> {entry.label}</th>
              <td><span className={`adm-server-state adm-server-state--${entry.status}`}>{entry.status}</span></td>
              <td>{entry.ms != null ? formatMs(entry.ms) : '—'}</td>
              <td className="adm-db-detail">{entry.detail || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {report.usage.length > 0 && (
        <>
          <h4 className="adm-db-sub">How full</h4>
          <ul className="adm-meters">
            {report.usage.map((entry) => <Meter key={entry.id} {...entry} />)}
          </ul>
        </>
      )}
      {children}
      {report.notes.map((note) => <p key={note} className="adm-note">{note}</p>)}
    </section>
  );
}

// One row of the meter list: name, bar against the plan's limit, figure.
// Near the limit the row says so in words, not only in color.
function Meter({ label, unit, used, limit, detail }) {
  const format = unit === 'bytes' ? formatBytes : formatCount;
  const name = (
    <span className="adm-meter-name">
      {label}
      {detail && <span className="adm-detail adm-muted">{detail}</span>}
    </span>
  );
  if (!limit) {
    return (
      <li className="adm-meter">
        {name}
        <span className="adm-meter-figure">{format(used)} <span className="adm-muted">· plan limit unknown</span></span>
      </li>
    );
  }
  const share = Math.min(1, used / limit);
  const level = share >= 0.95 ? 'full' : share >= 0.8 ? 'high' : 'ok';
  const flag = { full: 'Full', high: 'Almost full' }[level];
  const figure = `${format(used)} of ${format(limit)}`;
  const percent = formatPercent(used / limit);
  return (
    <li className={`adm-meter adm-meter--${level}`}>
      {name}
      <span
        className="adm-meter-track"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(share * 100)}
        aria-valuetext={`${figure}, ${percent}${flag ? `, ${flag.toLowerCase()}` : ''}`}
      >
        <span className="adm-meter-fill" style={{ width: `${share * 100}%` }} />
      </span>
      <span className="adm-meter-figure">
        {figure} · {percent}
        {flag && <span className="adm-meter-flag"><WarningCircle size={14} weight="bold" aria-hidden="true" /> {flag}</span>}
      </span>
    </li>
  );
}

function LargestTables({ tables }) {
  return (
    <>
      <h4 className="adm-db-sub">Largest tables</h4>
      <table className="adm-table">
        <thead>
          <tr><th scope="col">Table</th><th scope="col">Size</th><th scope="col">Rows (about)</th></tr>
        </thead>
        <tbody>
          {tables.map((table) => (
            <tr key={table.name}>
              <th scope="row">{table.name}</th>
              <td>{formatBytes(table.bytes)}</td>
              <td>{table.rows.toLocaleString('en-US')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function CatalogRows({ rows }) {
  return (
    <>
      <h4 className="adm-db-sub">Catalog</h4>
      <dl className="adm-facts">
        {rows.map((row) => (
          <div key={row.name}>
            <dt>{row.name}</dt>
            <dd>{row.rows.toLocaleString('en-US')}</dd>
            <dd className="adm-facts-sub">{row.updatedAt ? `as of ${timeAgo(row.updatedAt)}` : ''}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
