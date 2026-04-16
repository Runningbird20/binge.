import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api';

function QuickStatCard({ icon, label, value, color }) {
  return (
    <div className="admin-stat-card">
      <span className="admin-stat-icon" style={{ color }}>{icon}</span>
      <div className="admin-stat-info">
        <span className="admin-stat-value">{value ?? '—'}</span>
        <span className="admin-stat-label">{label}</span>
      </div>
    </div>
  );
}

function AdminNavCard({ to, icon, title, description, badge }) {
  return (
    <Link to={to} className="admin-nav-card">
      <div className="admin-nav-card-icon">{icon}</div>
      <div className="admin-nav-card-content">
        <div className="admin-nav-card-title">
          {title}
          {badge != null && badge > 0 && <span className="admin-nav-badge">{badge}</span>}
        </div>
        <p className="admin-nav-card-desc">{description}</p>
      </div>
      <span className="admin-nav-card-arrow">→</span>
    </Link>
  );
}

export default function AdminHome() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);

  useEffect(() => {
    api.get('/admin/stats').then(setStats).catch(() => {});
  }, []);

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content admin-page">

        {/* Header */}
        <div className="admin-header">
          <div>
            <p className="admin-kicker">🛡️ Admin Panel</p>
            <h1 className="admin-title">Control Center</h1>
            <p className="admin-subtitle">
              Welcome back, <strong>{user?.username}</strong>. Platform health at a glance.
            </p>
          </div>
          <div className="admin-header-badge">
            <span>🛡️</span>
            <span>Admin</span>
          </div>
        </div>

        {/* Quick stats */}
        <div className="admin-stats-row">
          <QuickStatCard icon="💬" label="Total Queries"    value={stats?.totalQueries?.toLocaleString()}       color="#e8c97a" />
          <QuickStatCard icon="📅" label="Queries (7d)"    value={stats?.queriesLast7Days?.toLocaleString()}    color="#7ab8e8" />
          <QuickStatCard icon="👥" label="Unique Users"    value={stats?.uniqueUsers?.toLocaleString()}         color="#86efac" />
          <QuickStatCard icon="⚡" label="Avg Latency"     value={stats ? (stats.avgLatencyMs < 1000 ? `${stats.avgLatencyMs}ms` : `${(stats.avgLatencyMs/1000).toFixed(1)}s`) : null} color="#c4b5fd" />
          <QuickStatCard icon="⚠️" label="Errors (7d)"    value={stats?.errorsLast7Days}                       color="#fca5a5" />
        </div>

        {/* Nav cards */}
        <div className="admin-nav-grid">
          <AdminNavCard
            to="/admin/analytics"
            icon="📊"
            title="Usage & Performance"
            description="Query logs, response times, latency trends, intent breakdown, and system errors."
          />
          <AdminNavCard
            to="/admin/requests"
            icon="📥"
            title="Media Requests"
            description="Review user-submitted requests to add movies, TV shows, and books to the catalog."
          />
          <AdminNavCard
            to="/admin/users"
            icon="👥"
            title="User Management"
            description="View all registered users, manage admin roles, and monitor account activity."
          />
          <AdminNavCard
            to="/forum"
            icon="💬"
            title="Forum Moderation"
            description="Monitor communities, remove posts, redact comments, and review flagged content."
          />
        </div>

        {/* System status */}
        <div className="admin-status-row">
          <div className="admin-status-card">
            <h3>🟢 System Status</h3>
            <div className="admin-status-items">
              <div className="admin-status-item"><span className="admin-status-dot green" />Express API</div>
              <div className="admin-status-item"><span className="admin-status-dot green" />SQLite Database</div>
              <div className="admin-status-item"><span className="admin-status-dot" style={{ background: stats ? '#4caf82' : '#888' }} />Admin Routes</div>
            </div>
          </div>
          <div className="admin-status-card">
            <h3>📈 Last 7 Days</h3>
            <div className="admin-status-items">
              <div className="admin-status-item">
                <span className="admin-status-dot" style={{ background: stats?.errorsLast7Days === 0 ? '#4caf82' : '#fca5a5' }} />
                {stats?.errorsLast7Days ?? '—'} errors logged
            <div className="devlab-list">
              <div className="devlab-list-item">
                <div className="devlab-list-copy">
                  <strong>Media Requests</strong>
                  <p>Review user-submitted requests to add movies, TV shows, and books.</p>
                </div>
                <div className="devlab-list-actions">
                  <Link to="/__ops/dev-lab#requests" className="btn-primary">Open In Dev Lab</Link>
                </div>
              </div>
              <div className="admin-status-item">
                <span className="admin-status-dot green" />
                {stats?.queriesLast7Days ?? '—'} chatbot queries
              </div>
              <div className="admin-status-item">
                <span className="admin-status-dot" style={{ background: stats?.avgLatencyMs < 3000 ? '#4caf82' : '#fde68a' }} />
                Avg {stats ? (stats.avgLatencyMs < 1000 ? `${stats.avgLatencyMs}ms` : `${(stats.avgLatencyMs/1000).toFixed(1)}s`) : '—'} response time
              </div>
            </div>
          </div>
        </div>

      </main>
    </div>
  );
}
