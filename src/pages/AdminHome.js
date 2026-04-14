import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { useAuth } from '../contexts/AuthContext';

export default function AdminHome() {
  const { user } = useAuth();

  return (
    <div className="app-layout">
      <Navbar minimal />
      <main className="page-content">
        <div className="page-header">
          <p className="page-kicker">Admin</p>
          <h1>Admin Control Center</h1>
          <p className="page-subtitle">
            Welcome back{user?.username ? `, ${user.username}` : ''}. This is the admin landing page for
            moderation and platform operations.
          </p>
        </div>

        <div className="stats-row">
          <div className="stat-card">
            <div className="stat-number">1</div>
            <div className="stat-label">Admin Role Active</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">3</div>
            <div className="stat-label">Primary Tools</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">0</div>
            <div className="stat-label">Hidden Nav Links</div>
          </div>
        </div>

        <div className="home-sections">
          <section className="home-section surface-panel">
            <div className="section-header">
              <div>
                <h2>Available Now</h2>
                <p className="home-panel-copy">
                  Start here for the admin tools that already exist in the app.
                </p>
              </div>
            </div>
            <div className="devlab-list">
              <div className="devlab-list-item">
                <div className="devlab-list-copy">
                  <strong>Media Requests</strong>
                  <p>Review user-submitted requests to add movies, TV shows, and books.</p>
                </div>
                <div className="devlab-list-actions">
                  <Link to="/admin/requests" className="btn-primary">Open Requests</Link>
                </div>
              </div>
              <div className="devlab-list-item">
                <div className="devlab-list-copy">
                  <strong>Usage Logs &amp; Performance</strong>
                  <p>View chatbot query logs, response times, intent breakdown, and system errors.</p>
                </div>
                <div className="devlab-list-actions">
                  <Link to="/admin/analytics" className="btn-primary">Open Analytics</Link>
                </div>
              </div>
            </div>
          </section>

          <section className="home-section surface-panel">
            <div className="section-header">
              <div>
                <h2>Next Step</h2>
                <p className="home-panel-copy">
                  This page is the new admin landing route. We can keep expanding it with more admin tools
                  whenever you want.
                </p>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
