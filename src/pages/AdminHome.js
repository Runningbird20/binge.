import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { useAuth } from '../contexts/AuthContext';

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

        {/* Nav cards */}
        <div className="admin-nav-grid">
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
        </div>

        {/* System status */}
        <div className="admin-status-row">
          <div className="admin-status-card">
            <h3>🟢 System Status</h3>
            <div className="admin-status-items">
              <div className="admin-status-item"><span className="admin-status-dot green" />Express API</div>
              <div className="admin-status-item"><span className="admin-status-dot green" />SQLite Database</div>
              <div className="admin-status-item"><span className="admin-status-dot green" />Admin Routes</div>
            </div>
          </div>
        </div>

      </main>
    </div>
  );
}
