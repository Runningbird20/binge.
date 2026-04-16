import { useState, useEffect, useCallback } from 'react';
import Navbar from '../components/Navbar';
import { api } from '../api';

const INTENT_LABELS = {
  recommendation: 'Recommendation',
  thematic: 'Thematic',
  factual: 'Factual',
  general: 'General',
  unknown: 'Unknown',
};

const INTENT_COLORS = {
  recommendation: '#e8c97a',
  thematic: '#7ab8e8',
  factual: '#86efac',
  general: '#c4b5fd',
  unknown: '#888',
};

const DAY_FILTERS = [
  { label: 'Last 7 days', value: 7 },
  { label: 'Last 30 days', value: 30 },
  { label: 'Last 90 days', value: 90 },
];

function formatMs(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function StatCard({ label, value, sub }) {
  return (
    <div className="stat-card" style={{ minWidth: 140, flex: '1 1 140px' }}>
      <div className="stat-number" style={{ fontSize: '1.6rem' }}>{value ?? '—'}</div>
      <div className="stat-label">{label}</div>
      {sub && <div style={{ fontSize: '0.75rem', color: '#555', marginTop: '0.25rem' }}>{sub}</div>}
    </div>
  );
}

function MiniBar({ value, max }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div style={{ background: '#1a1a1a', borderRadius: 4, height: 6, overflow: 'hidden', flex: 1 }}>
      <div style={{ width: `${pct}%`, height: '100%', background: '#e8c97a', borderRadius: 4, transition: 'width 0.4s' }} />
    </div>
  );
}

export default function AdminAnalytics() {
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState('');

  const [logs, setLogs] = useState([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsPage, setLogsPage] = useState(1);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState('');
  const [intentFilter, setIntentFilter] = useState('');
  const [daysFilter, setDaysFilter] = useState(30);

  const [errors, setErrors] = useState([]);
  const [errorsTotal, setErrorsTotal] = useState(0);
  const [errorsLoading, setErrorsLoading] = useState(false);
  const [errorsError, setErrorsError] = useState('');

  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    let cancelled = false;
    setStatsLoading(true);
    setStatsError('');
    api.get('/admin/stats')
      .then(data => { if (!cancelled) setStats(data); })
      .catch(err => { if (!cancelled) setStatsError(err.message); })
      .finally(() => { if (!cancelled) setStatsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const fetchLogs = useCallback(() => {
    let cancelled = false;
    setLogsLoading(true);
    setLogsError('');
    const params = new URLSearchParams({ page: logsPage, limit: 25, days: daysFilter });
    if (intentFilter) params.set('intent', intentFilter);
    api.get(`/admin/logs?${params}`)
      .then(data => {
        if (!cancelled) {
          setLogs(data.rows);
          setLogsTotal(data.total);
        }
      })
      .catch(err => { if (!cancelled) setLogsError(err.message); })
      .finally(() => { if (!cancelled) setLogsLoading(false); });
    return () => { cancelled = true; };
  }, [logsPage, intentFilter, daysFilter]);

  useEffect(() => {
    if (activeTab === 'logs') return fetchLogs();
  }, [activeTab, fetchLogs]);

  useEffect(() => {
    if (activeTab !== 'errors') return;
    let cancelled = false;
    setErrorsLoading(true);
    setErrorsError('');
    api.get('/admin/errors?limit=50')
      .then(data => {
        if (!cancelled) {
          setErrors(data.rows);
          setErrorsTotal(data.total);
        }
      })
      .catch(err => { if (!cancelled) setErrorsError(err.message); })
      .finally(() => { if (!cancelled) setErrorsLoading(false); });
    return () => { cancelled = true; };
  }, [activeTab]);

  const logsPageCount = Math.max(1, Math.ceil(logsTotal / 25));

  // Build day-chart bars
  const chartData = stats?.queriesPerDay ?? [];
  const chartMax = chartData.length > 0 ? Math.max(...chartData.map(d => d.count), 1) : 1;

  return (
    <div className="app-layout">
      <Navbar minimal />
      <main className="page-content">
        <div className="page-header">
          <p className="page-kicker">Admin</p>
          <h1>Usage Logs &amp; Performance</h1>
          <p className="page-subtitle">
            Chatbot query logs, response times, and system errors.
          </p>
        </div>

        {/* Tab bar */}
        <div className="tabs" style={{ marginBottom: '1.5rem' }}>
          {[
            { id: 'overview', label: 'Overview' },
            { id: 'logs',     label: 'Query Logs' },
            { id: 'errors',   label: `Errors${stats ? ` (${stats.totalErrors})` : ''}` },
          ].map(t => (
            <button
              key={t.id}
              className={`tab-btn ${activeTab === t.id ? 'active' : ''}`}
              onClick={() => setActiveTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Overview tab ── */}
        {activeTab === 'overview' && (
          <>
            {statsError && <div className="auth-error" style={{ marginBottom: '1rem' }}>{statsError}</div>}
            {statsLoading ? (
              <div className="loading-state">Loading stats...</div>
            ) : stats ? (
              <>
                {/* Stat cards */}
                <div className="stats-row">
                  <StatCard label="Total Queries" value={stats.totalQueries.toLocaleString()} />
                  <StatCard label="Queries (7d)" value={stats.queriesLast7Days.toLocaleString()} />
                  <StatCard label="Queries (30d)" value={stats.queriesLast30Days.toLocaleString()} />
                  <StatCard label="Unique Users" value={stats.uniqueUsers.toLocaleString()} />
                  <StatCard label="Avg Latency" value={formatMs(stats.avgLatencyMs)} />
                  <StatCard label="P95 Latency" value={formatMs(stats.p95LatencyMs)} />
                  <StatCard label="Max Latency" value={formatMs(stats.maxLatencyMs)} />
                  <StatCard
                    label="Errors (7d)"
                    value={stats.errorsLast7Days}
                    sub={`${stats.totalErrors} total`}
                  />
                </div>

                {/* Queries per day chart */}
                <div className="home-sections">
                  <section className="home-section surface-panel" style={{ padding: '1.5rem' }}>
                    <div className="section-header" style={{ marginBottom: '1rem' }}>
                      <div>
                        <h2 style={{ margin: 0, color: '#f7f3ea', fontSize: '1rem' }}>Queries per Day (last 30 days)</h2>
                      </div>
                    </div>
                    {chartData.length === 0 ? (
                      <p style={{ color: '#555', margin: 0 }}>No data yet.</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        {chartData.map(d => (
                          <div key={d.date} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.8rem' }}>
                            <span style={{ color: '#666', width: 90, flexShrink: 0 }}>{d.date}</span>
                            <MiniBar value={d.count} max={chartMax} />
                            <span style={{ color: '#aaa', width: 30, textAlign: 'right', flexShrink: 0 }}>{d.count}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  {/* Intent breakdown */}
                  <section className="home-section surface-panel" style={{ padding: '1.5rem' }}>
                    <div className="section-header" style={{ marginBottom: '1rem' }}>
                      <div>
                        <h2 style={{ margin: 0, color: '#f7f3ea', fontSize: '1rem' }}>Query Intent Breakdown</h2>
                      </div>
                    </div>
                    {stats.intentBreakdown.length === 0 ? (
                      <p style={{ color: '#555', margin: 0 }}>No data yet.</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                        {stats.intentBreakdown.map(row => {
                          const pct = stats.totalQueries > 0
                            ? Math.round((row.count / stats.totalQueries) * 100)
                            : 0;
                          return (
                            <div key={row.intent} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.85rem' }}>
                              <span
                                style={{
                                  width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                                  background: INTENT_COLORS[row.intent] || '#888',
                                }}
                              />
                              <span style={{ color: '#ccc', width: 120, flexShrink: 0 }}>
                                {INTENT_LABELS[row.intent] || row.intent}
                              </span>
                              <div style={{ background: '#1a1a1a', borderRadius: 4, height: 6, flex: 1, overflow: 'hidden' }}>
                                <div
                                  style={{
                                    width: `${pct}%`, height: '100%', borderRadius: 4,
                                    background: INTENT_COLORS[row.intent] || '#888',
                                    transition: 'width 0.4s',
                                  }}
                                />
                              </div>
                              <span style={{ color: '#888', width: 55, textAlign: 'right', flexShrink: 0 }}>
                                {row.count} ({pct}%)
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                </div>
              </>
            ) : null}
          </>
        )}

        {/* ── Logs tab ── */}
        {activeTab === 'logs' && (
          <>
            {/* Filters */}
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem', alignItems: 'center' }}>
              <div className="tabs" style={{ margin: 0 }}>
                {['', 'recommendation', 'thematic', 'factual', 'general'].map(v => (
                  <button
                    key={v || 'all'}
                    className={`tab-btn ${intentFilter === v ? 'active' : ''}`}
                    onClick={() => { setIntentFilter(v); setLogsPage(1); }}
                  >
                    {v ? (INTENT_LABELS[v] || v) : 'All Intents'}
                  </button>
                ))}
              </div>
              <select
                value={daysFilter}
                onChange={e => { setDaysFilter(Number(e.target.value)); setLogsPage(1); }}
                style={{
                  background: '#141414', border: '1px solid #2a2a2a', color: '#ccc',
                  borderRadius: 8, padding: '0.4rem 0.7rem', fontSize: '0.85rem', cursor: 'pointer',
                }}
              >
                {DAY_FILTERS.map(d => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
            </div>

            {logsError && <div className="auth-error" style={{ marginBottom: '1rem' }}>{logsError}</div>}

            {logsLoading ? (
              <div className="loading-state">Loading logs...</div>
            ) : logs.length === 0 ? (
              <div className="empty-state"><p>No logs found.</p></div>
            ) : (
              <>
                <div style={{ fontSize: '0.8rem', color: '#555', marginBottom: '0.75rem' }}>
                  {logsTotal.toLocaleString()} total entries
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #2a2a2a' }}>
                        {['Timestamp', 'User', 'Intent', 'Query', 'Latency', 'Resp. Length', 'Sources'].map(h => (
                          <th key={h} style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: '#666', fontWeight: 600, whiteSpace: 'nowrap' }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map(row => (
                        <tr key={row.id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                          <td style={{ padding: '0.5rem 0.75rem', color: '#666', whiteSpace: 'nowrap' }}>
                            {formatDate(row.created_at)}
                          </td>
                          <td style={{ padding: '0.5rem 0.75rem', color: '#aaa' }}>
                            {row.username ? `@${row.username}` : `#${row.user_id}`}
                          </td>
                          <td style={{ padding: '0.5rem 0.75rem' }}>
                            <span style={{
                              fontSize: '0.72rem', fontWeight: 700, padding: '0.15rem 0.45rem',
                              borderRadius: 999, background: 'rgba(232,201,122,0.1)',
                              border: '1px solid rgba(232,201,122,0.2)',
                              color: INTENT_COLORS[row.intent] || '#888',
                            }}>
                              {INTENT_LABELS[row.intent] || row.intent || '—'}
                            </span>
                          </td>
                          <td style={{ padding: '0.5rem 0.75rem', color: '#ccc', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {row.query}
                          </td>
                          <td style={{ padding: '0.5rem 0.75rem', color: row.latency_ms > 5000 ? '#fca5a5' : row.latency_ms > 2000 ? '#fde68a' : '#86efac', whiteSpace: 'nowrap' }}>
                            {formatMs(row.latency_ms)}
                          </td>
                          <td style={{ padding: '0.5rem 0.75rem', color: '#666', textAlign: 'right' }}>
                            {row.response_length ?? '—'}
                          </td>
                          <td style={{ padding: '0.5rem 0.75rem', color: '#666', textAlign: 'right' }}>
                            {row.sources_count ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {logsPageCount > 1 && (
                  <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', marginTop: '1.25rem', flexWrap: 'wrap' }}>
                    <button
                      className="btn-ghost btn-sm"
                      disabled={logsPage <= 1}
                      onClick={() => setLogsPage(p => p - 1)}
                    >
                      Previous
                    </button>
                    <span style={{ color: '#666', alignSelf: 'center', fontSize: '0.85rem' }}>
                      Page {logsPage} of {logsPageCount}
                    </span>
                    <button
                      className="btn-ghost btn-sm"
                      disabled={logsPage >= logsPageCount}
                      onClick={() => setLogsPage(p => p + 1)}
                    >
                      Next
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ── Errors tab ── */}
        {activeTab === 'errors' && (
          <>
            {errorsError && <div className="auth-error" style={{ marginBottom: '1rem' }}>{errorsError}</div>}
            {errorsLoading ? (
              <div className="loading-state">Loading errors...</div>
            ) : errors.length === 0 ? (
              <div className="empty-state">
                <p>No errors logged.</p>
                <p className="empty-hint">Chatbot failures will appear here when they occur.</p>
              </div>
            ) : (
              <>
                <div style={{ fontSize: '0.8rem', color: '#555', marginBottom: '0.75rem' }}>
                  {errorsTotal.toLocaleString()} total errors (showing last 50)
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {errors.map(err => (
                    <div
                      key={err.id}
                      style={{
                        background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.15)',
                        borderRadius: 8, padding: '0.75rem 1rem',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.25rem' }}>
                        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#fca5a5' }}>
                          {err.error_type || 'Error'}
                        </span>
                        <span style={{ fontSize: '0.75rem', color: '#555' }}>
                          {formatDate(err.created_at)}
                          {err.user_id ? ` · user #${err.user_id}` : ' · anonymous'}
                        </span>
                      </div>
                      <p style={{ margin: 0, fontSize: '0.83rem', color: '#aaa' }}>
                        {err.error_message || '—'}
                      </p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
