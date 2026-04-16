import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { api } from '../api';
import { useAuth } from '../contexts/AuthContext';

export default function AdminUsers() {
  const { user: currentUser } = useAuth();
  const [users, setUsers]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [search, setSearch]   = useState('');
  const [toggling, setToggling] = useState(null);

  useEffect(() => {
    api.get('/admin/users').then(setUsers).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, []);

  async function handleToggleAdmin(userId) {
    if (userId === currentUser?.id) return alert("You can't change your own admin status.");
    setToggling(userId);
    try {
      const updated = await api.patch(`/admin/users/${userId}/toggle-admin`, {});
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, is_admin: updated.is_admin } : u));
    } catch (err) { alert(err.message); }
    finally { setToggling(null); }
  }

  const filtered = users.filter(u =>
    u.username?.toLowerCase().includes(search.toLowerCase()) ||
    u.email?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content admin-page">
        <div className="admin-header">
          <div>
            <Link to="/admin" className="admin-breadcrumb">← Admin</Link>
            <h1 className="admin-title">User Management</h1>
            <p className="admin-subtitle">{users.length} registered users</p>
          </div>
        </div>

        {error && <div className="admin-error-banner">{error}</div>}

        <input
          className="search-input"
          placeholder="Search by username or email..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ marginBottom: '1.25rem', maxWidth: 400 }}
        />

        {loading ? <div className="loading-state">Loading users...</div> : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  {['Username', 'Email', 'Joined', 'Public', 'Admin', 'Actions'].map(h => <th key={h}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {filtered.map(u => (
                  <tr key={u.id}>
                    <td>
                      <Link to={`/profile/${u.username}`} className="admin-user-link">
                        {u.is_admin && <span className="admin-badge-mini">🛡️</span>}
                        {u.username}
                      </Link>
                    </td>
                    <td style={{ color: '#666', fontSize: '0.8rem' }}>{u.email}</td>
                    <td className="admin-td-mono">{new Date(u.created_at).toLocaleDateString()}</td>
                    <td>{u.is_public ? <span style={{ color: '#86efac' }}>✓</span> : <span style={{ color: '#555' }}>—</span>}</td>
                    <td>{u.is_admin ? <span style={{ color: '#e8c97a' }}>🛡️ Admin</span> : <span style={{ color: '#555' }}>—</span>}</td>
                    <td>
                      {u.id !== currentUser?.id && (
                        <button
                          className={`btn-sm ${u.is_admin ? 'btn-ghost' : 'btn-ghost'}`}
                          style={{ fontSize: '0.72rem', color: u.is_admin ? '#fca5a5' : '#86efac' }}
                          onClick={() => handleToggleAdmin(u.id)}
                          disabled={toggling === u.id}
                          type="button"
                        >
                          {toggling === u.id ? '...' : u.is_admin ? 'Remove Admin' : 'Make Admin'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
