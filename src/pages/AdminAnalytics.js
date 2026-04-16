import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { api } from '../api';

const INTENT_LABELS = {
  recommendation: 'Recommendation', thematic: 'Thematic',
  factual: 'Factual', general: 'General', unknown: 'Unknown',
};
const INTENT_COLORS = {
  recommendation: '#e8c97a', thematic: '#7ab8e8',
  factual: '#86efac', general: '#c4b5fd', unknown: '#888',
};
const DAY_FILTERS = [
  { label: '7 days', value: 7 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
];

function formatMs(ms) {
  if (ms == null || ms === 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}
function latencyColor(ms) {
  if (ms == null) return '#555';
  if (ms > 5000) return '#fca5a5';
  if (ms > 2000) return '#fde68a';
  return '#86efac';
}
function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}
function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth()+1}/${d.getDate()}`;
}

// Simple bar chart
function BarChart({ data, valueKey = 'count', labelKey = 'day', color = '#e8c97a', height = 80 }) {
  if (!data || data.length === 0) return <div style={{ color: '#333', fontSize: '0.8rem', padding: '1rem 0' }}>No data</div>;
  const max = Math.max(...data.map(d => d[valueKey]), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height, overflow: 'hidden' }}>
      {data.map((d, i) => {
        const pct = (d[valueKey] / max) * 100;
        return (
          <div key={i} title={`${shortDate(d[labelKey])}: ${d[valueKey]}`}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%', cursor: 'default' }}>
            <div style={{ width: '100%', height: `${Math.max(pct, 2)}%`, background: color, borderRadius: '2px 2px 0 0', opacity: 0.85, transition: 'height 0.3s' }} />
          </div>
        );
      })}
    </div>
  );
}

function StatCard({ label, value, sub, color, icon }) {
  return (
    <div className="admin-stat-card">
      {icon && <span className="admin-stat-icon" style={{ color }}>{icon}</span>}
      <div className="admin-stat-info">
        <span className="admin-stat-value" style={{ color: color || '#e8e8e8' }}>{value ?? '—'}</span>
        <span className="admin-stat-label">{label}</span>
        {sub && <span className="admin-stat-sub">{sub}</span>}
      </div>
    </div>
  );
}

export default function AdminAnalytics() {
  const [stats, setStats]         = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError]   = useState('');

  const [logs, setLogs]           = useState([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsPage, setLogsPage]   = useState(1);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState('');
  const [intentFilter, setIntentFilter] = useState('');
  const [daysFilter, setDaysFilter]     = useState(30);

  const [errors, setErrors]       = useState([]);
  const [errorsTotal, setErrorsTotal] = useState(0);
  const [errorsLoading, setErrorsLoading] = useState(false);
  const [errorsError, setErrorsError]   = useState('');

  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    let cancelled = false;
    setStatsLoading(true); setStatsError('');
    api.get('/admin/stats')
      .then(d => { if (!cancelled) setStats(d); })
      .catch(e => { if (!cancelled) setStatsError(e.message); })
      .finally(() => { if (!cancelled) setStatsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const fetchLogs = useCallback(() => {
    let cancelled = false;
    setLogsLoading(true); setLogsError('');
    const params = new URLSearchParams({ page: logsPage, limit: 25, days: daysFilter });
    if (intentFilter) params.set('intent', intentFilter);
    api.get(`/admin/logs?${params}`)
      .then(d => { if (!cancelled) { setLogs(d.rows); setLogsTotal(d.total); } })
      .catch(e => { if (!cancelled) setLogsError(e.message); })
      .finally(() => { if (!cancelled) setLogsLoading(false); });
    return () => { cancelled = true; };
  }, [logsPage, intentFilter, daysFilter]);

  useEffect(() => {
    if (activeTab === 'logs') return fetchLogs();
  }, [activeTab, fetchLogs]);

  useEffect(() => {
    if (activeTab !== 'errors') return;
    let cancelled = false;
    setErrorsLoading(true); setErrorsError('');
    api.get('/admin/errors?limit=50')
      .then(d => { if (!cancelled) { setErrors(d.rows); setErrorsTotal(d.total); } })
      .catch(e => { if (!cancelled) setErrorsError(e.message); })
      .finally(() => { if (!cancelled) setErrorsLoading(false); });
    return () => { cancelled = true; };
  }, [activeTab]);

  const logsPageCount = Math.max(1, Math.ceil(logsTotal / 25));
  const chartData  = stats?.queriesPerDay  ?? [];
  const latData    = stats?.latencyPerDay  ?? [];

  const TABS = [
    { id: 'overview', label: '📊 Overview' },
    { id: 'logs',     label: '🗒️ Query Logs' },
    { id: 'errors',   label: `⚠️ Errors${stats ? ` (${stats.totalErrors})` : ''}` },
  ];

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content admin-page">

        <div className="admin-header">
          <div>
            <Link to="/admin" className="admin-breadcrumb">← Admin</Link>
            <h1 className="admin-title">Usage &amp; Performance</h1>
            <p className="admin-subtitle">Chatbot query logs, response times, and system errors.</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="admin-tabs">
          {TABS.map(t => (
            <button key={t.id} className={`admin-tab ${activeTab === t.id ? 'active' : ''}`} onClick={() => setActiveTab(t.id)} type="button">
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Overview ── */}
        {activeTab === 'overview' && (
          <>
            {statsError && <div className="admin-error-banner">{statsError}</div>}
            {statsLoading ? <div className="loading-state">Loading stats...</div> : stats ? (
              <>
                {/* Usage metrics */}
                <div className="admin-section-label">📈 Usage Metrics</div>
                <div className="admin-stats-row">
                  <StatCard icon="💬" label="Total Queries"  value={stats.totalQueries.toLocaleString()}       color="#e8c97a" />
                  <StatCard icon="📅" label="Last 7 Days"    value={stats.queriesLast7Days.toLocaleString()}    color="#7ab8e8" />
                  <StatCard icon="📆" label="Last 30 Days"   value={stats.queriesLast30Days.toLocaleString()}   color="#7ab8e8" />
                  <StatCard icon="👥" label="Unique Users"   value={stats.uniqueUsers.toLocaleString()}         color="#86efac" />
                </div>

                {/* Performance metrics */}
                <div className="admin-section-label" style={{ marginTop: '1.5rem' }}>⚡ Performance</div>
                <div className="admin-stats-row">
                  <StatCard icon="⚡" label="Avg Latency"    value={formatMs(stats.avgLatencyMs)}    color={latencyColor(stats.avgLatencyMs)}   sub="mean response time" />
                  <StatCard icon="📊" label="P95 Latency"    value={formatMs(stats.p95LatencyMs)}    color={latencyColor(stats.p95LatencyMs)}   sub="95th percentile" />
                  <StatCard icon="🔺" label="Max Latency"    value={formatMs(stats.maxLatencyMs)}    color={latencyColor(stats.maxLatencyMs)}   sub="worst single query" />
                  <StatCard icon="🐢" label="Slow Queries"   value={stats.slowQueries}               color={stats.slowQueries > 0 ? '#fca5a5' : '#86efac'} sub=">5s response (30d)" />
                  <StatCard icon="⚠️" label="Errors (7d)"   value={stats.errorsLast7Days}           color={stats.errorsLast7Days > 0 ? '#fca5a5' : '#86efac'} sub={`${stats.totalErrors} total`} />
                </div>

                {/* Performance health bar */}
                <div className="admin-health-card">
                  <div className="admin-health-header">
                    <span>🩺 Performance Health</span>
                    <span className={`admin-health-badge ${stats.avgLatencyMs < 2000 ? 'good' : stats.avgLatencyMs < 5000 ? 'warn' : 'bad'}`}>
                      {stats.avgLatencyMs < 2000 ? '✓ Good' : stats.avgLatencyMs < 5000 ? '⚠ Degraded' : '✗ Poor'}
                    </span>
                  </div>
                  <div className="admin-health-items">
                    <div className="admin-health-item">
                      <span>Avg latency</span>
                      <div className="admin-health-bar-wrap">
                        <div className="admin-health-bar" style={{ width: `${Math.min(100, (stats.avgLatencyMs / 10000) * 100)}%`, background: latencyColor(stats.avgLatencyMs) }} />
                      </div>
                      <span style={{ color: latencyColor(stats.avgLatencyMs) }}>{formatMs(stats.avgLatencyMs)}</span>
                    </div>
                    <div className="admin-health-item">
                      <span>P95 latency</span>
                      <div className="admin-health-bar-wrap">
                        <div className="admin-health-bar" style={{ width: `${Math.min(100, (stats.p95LatencyMs / 10000) * 100)}%`, background: latencyColor(stats.p95LatencyMs) }} />
                      </div>
                      <span style={{ color: latencyColor(stats.p95LatencyMs) }}>{formatMs(stats.p95LatencyMs)}</span>
                    </div>
                    <div className="admin-health-item">
                      <span>Error rate (7d)</span>
                      <div className="admin-health-bar-wrap">
                        <div className="admin-health-bar" style={{ width: `${stats.queriesLast7Days > 0 ? Math.min(100, (stats.errorsLast7Days / stats.queriesLast7Days) * 100) : 0}%`, background: '#fca5a5' }} />
                      </div>
                      <span style={{ color: stats.errorsLast7Days > 0 ? '#fca5a5' : '#86efac' }}>
                        {stats.queriesLast7Days > 0 ? `${((stats.errorsLast7Days / stats.queriesLast7Days) * 100).toFixed(1)}%` : '0%'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Charts */}
                <div className="admin-charts-row">
                  <div className="admin-chart-card">
                    <h3>Queries per Day <span>(last 30 days)</span></h3>
                    <BarChart data={chartData} valueKey="count" labelKey="day" color="#e8c97a" />
                    <div className="admin-chart-xaxis">
                      {chartData.length > 0 && <>
                        <span>{shortDate(chartData[0]?.day)}</span>
                        <span>{shortDate(chartData[Math.floor(chartData.length/2)]?.day)}</span>
                        <span>{shortDate(chartData[chartData.length-1]?.day)}</span>
                      </>}
                    </div>
                  </div>
                  <div className="admin-chart-card">
                    <h3>Avg Latency per Day <span>(last 30 days)</span></h3>
                    <BarChart data={latData} valueKey="avg_ms" labelKey="day" color="#7ab8e8" />
                    <div className="admin-chart-xaxis">
                      {latData.length > 0 && <>
                        <span>{shortDate(latData[0]?.day)}</span>
                        <span>{shortDate(latData[Math.floor(latData.length/2)]?.day)}</span>
                        <span>{shortDate(latData[latData.length-1]?.day)}</span>
                      </>}
                    </div>
                  </div>
                </div>

                {/* Intent breakdown + Top queries */}
                <div className="admin-bottom-row">
                  <div className="admin-chart-card">
                    <h3>Intent Breakdown <span>(last 30 days)</span></h3>
                    {stats.intentBreakdown?.length === 0
                      ? <p style={{ color: '#333', fontSize: '0.8rem' }}>No data yet.</p>
                      : stats.intentBreakdown?.map(row => {
                          const total = stats.queriesLast30Days || 1;
                          const pct = Math.round((row.count / total) * 100);
                          return (
                            <div key={row.intent} className="admin-intent-row">
                              <span className="admin-intent-label" style={{ color: INTENT_COLORS[row.intent] || '#888' }}>
                                {INTENT_LABELS[row.intent] || row.intent || 'Unknown'}
                              </span>
                              <div className="admin-intent-bar-wrap">
                                <div className="admin-intent-bar" style={{ width: `${pct}%`, background: INTENT_COLORS[row.intent] || '#555' }} />
                              </div>
                              <span className="admin-intent-count">{row.count} ({pct}%)</span>
                            </div>
                          );
                        })
                    }
                  </div>
                  <div className="admin-chart-card">
                    <h3>Top Queries <span>(last 30 days)</span></h3>
                    {stats.topQueries?.length === 0
                      ? <p style={{ color: '#333', fontSize: '0.8rem' }}>No data yet.</p>
                      : <div className="admin-top-queries">
                          {stats.topQueries?.map((q, i) => (
                            <div key={i} className="admin-top-query-row">
                              <span className="admin-top-query-rank">#{i+1}</span>
                              <span className="admin-top-query-text">{q.query}</span>
                              <span className="admin-top-query-count">{q.count}×</span>
                            </div>
                          ))}
                        </div>
                    }
                  </div>
                </div>
              </>
            ) : null}
          </>
        )}

        {/* ── Query Logs ── */}
        {activeTab === 'logs' && (
          <>
            <div className="admin-logs-filters">
              <div className="admin-tabs" style={{ margin: 0 }}>
                {['', 'recommendation', 'thematic', 'factual', 'general'].map(v => (
                  <button
                    key={v || 'all'}
                    className={`admin-tab admin-tab--sm ${intentFilter === v ? 'active' : ''}`}
                    onClick={() => { setIntentFilter(v); setLogsPage(1); }}
                    type="button"
                  >
                    {v ? (INTENT_LABELS[v] || v) : 'All'}
                  </button>
                ))}
              </div>
              <select
                className="admin-select"
                value={daysFilter}
                onChange={e => { setDaysFilter(Number(e.target.value)); setLogsPage(1); }}
              >
                {DAY_FILTERS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>

            {logsError && <div className="admin-error-banner">{logsError}</div>}

            {logsLoading ? <div className="loading-state">Loading logs...</div>
            : logs.length === 0 ? <div className="empty-state"><p>No logs found.</p></div>
            : <>
                <p className="admin-table-count">{logsTotal.toLocaleString()} entries</p>
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        {['Timestamp', 'User', 'Intent', 'Query', 'Latency', 'Resp.', 'Sources'].map(h => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map(row => (
                        <tr key={row.id}>
                          <td className="admin-td-mono">{formatDate(row.created_at)}</td>
                          <td>{row.username ? `@${row.username}` : `#${row.user_id}`}</td>
                          <td>
                            <span className="admin-intent-pill" style={{ color: INTENT_COLORS[row.intent] || '#888', borderColor: (INTENT_COLORS[row.intent] || '#888') + '44', background: (INTENT_COLORS[row.intent] || '#888') + '11' }}>
                              {INTENT_LABELS[row.intent] || row.intent || '—'}
                            </span>
                          </td>
                          <td className="admin-td-query">{row.query}</td>
                          <td className="admin-td-mono" style={{ color: latencyColor(row.latency_ms) }}>{formatMs(row.latency_ms)}</td>
                          <td className="admin-td-num">{row.response_length ?? '—'}</td>
                          <td className="admin-td-num">{row.sources_count ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {logsPageCount > 1 && (
                  <div className="admin-pagination">
                    <button className="btn-ghost btn-sm" disabled={logsPage <= 1} onClick={() => setLogsPage(p => p-1)}>← Prev</button>
                    <span>Page {logsPage} of {logsPageCount}</span>
                    <button className="btn-ghost btn-sm" disabled={logsPage >= logsPageCount} onClick={() => setLogsPage(p => p+1)}>Next →</button>
                  </div>
                )}
              </>
            }
          </>
        )}

        {/* ── Errors ── */}
        {activeTab === 'errors' && (
          <>
            {errorsError && <div className="admin-error-banner">{errorsError}</div>}
            {errorsLoading ? <div className="loading-state">Loading errors...</div>
            : errors.length === 0 ? (
              <div className="empty-state">
                <p>🎉 No errors logged</p>
                <p className="empty-hint">Chatbot failures will appear here when they occur.</p>
              </div>
            ) : (
              <>
                <p className="admin-table-count">{errorsTotal.toLocaleString()} total errors (showing last 50)</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {errors.map(err => (
                    <div key={err.id} className="admin-error-row">
                      <div className="admin-error-row-header">
                        <span className="admin-error-type">{err.error_type || 'Error'}</span>
                        <span className="admin-error-meta">
                          {formatDate(err.created_at)}
                          {err.user_id ? ` · user #${err.user_id}` : ' · anonymous'}
                        </span>
                      </div>
                      <p className="admin-error-msg">{err.error_message || '—'}</p>
                      {err.context && <p className="admin-error-context">{err.context}</p>}
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
