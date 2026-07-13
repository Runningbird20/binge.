import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { api } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { createSupabaseUserAsAdmin } from '../utils/supabaseData';

const NEW_USER_FORM = { username: '', email: '', password: '', bio: '', isAdmin: false };

function CreateUserForm({ onCreated, onCancel }) {
  const [form, setForm]       = useState(NEW_USER_FORM);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');

  function update(field, value) {
    setForm(f => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const created = await createSupabaseUserAsAdmin(form);

      if (form.isAdmin) {
        const updated = await api.patch(`/admin/users/${created.id}/toggle-admin`, {});
        created.is_admin = updated.is_admin;
      }

      if (created.requiresEmailConfirmation) {
        alert(`Account created for @${created.username}. They'll need to confirm their email before they can log in.`);
      }

      onCreated(created);
      setForm(NEW_USER_FORM);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="admin-create-user-form" onSubmit={handleSubmit} style={{ marginBottom: '1.25rem' }}>
      {error && <div className="admin-error-banner">{error}</div>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
        <input
          className="search-input" style={{ flex: '1 1 160px' }}
          placeholder="Username" value={form.username}
          onChange={e => update('username', e.target.value)} required
        />
        <input
          className="search-input" style={{ flex: '1 1 200px' }}
          type="email" placeholder="Email" value={form.email}
          onChange={e => update('email', e.target.value)} required
        />
        <input
          className="search-input" style={{ flex: '1 1 160px' }}
          type="password" placeholder="Password (min 6 chars)" value={form.password}
          onChange={e => update('password', e.target.value)} required minLength={6}
        />
        <input
          className="search-input" style={{ flex: '2 1 220px' }}
          placeholder="Bio (optional)" value={form.bio}
          onChange={e => update('bio', e.target.value)}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: '#bbb' }}>
          <input type="checkbox" checked={form.isAdmin} onChange={e => update('isAdmin', e.target.checked)} />
          Admin
        </label>
        <button className="btn-primary btn-sm" type="submit" disabled={saving}>
          {saving ? 'Creating...' : 'Create Account'}
        </button>
        <button className="btn-ghost btn-sm" type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function formatLastLogin(value) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString();
}

export default function AdminUsers() {
  const { user: currentUser } = useAuth();
  const [users, setUsers]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [search, setSearch]   = useState('');
  const [toggling, setToggling] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

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

  async function handleDelete(user) {
    if (user.id === currentUser?.id) return alert("You can't delete your own account.");
    if (!window.confirm(`Permanently delete @${user.username}'s account? This cannot be undone.`)) return;
    setDeleting(user.id);
    try {
      await api.delete(`/admin/users/${user.id}`);
      setUsers(prev => prev.filter(u => u.id !== user.id));
    } catch (err) { alert(err.message); }
    finally { setDeleting(null); }
  }

  function handleCreated(created) {
    setUsers(prev => [created, ...prev]);
    setShowCreate(false);
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
          <button className="btn-primary btn-sm" type="button" onClick={() => setShowCreate(v => !v)}>
            {showCreate ? 'Close' : '+ New User'}
          </button>
        </div>

        {error && <div className="admin-error-banner">{error}</div>}

        {showCreate && (
          <CreateUserForm onCreated={handleCreated} onCancel={() => setShowCreate(false)} />
        )}

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
                  {['Username', 'Email', 'Joined', 'Last Login', 'Public', 'Admin', 'Actions'].map(h => <th key={h}>{h}</th>)}
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
                    <td className="admin-td-mono" style={{ color: u.last_sign_in_at ? undefined : '#555' }}>
                      {formatLastLogin(u.last_sign_in_at)}
                    </td>
                    <td>{u.is_public ? <span style={{ color: '#86efac' }}>✓</span> : <span style={{ color: '#555' }}>—</span>}</td>
                    <td>{u.is_admin ? <span style={{ color: '#e8c97a' }}>🛡️ Admin</span> : <span style={{ color: '#555' }}>—</span>}</td>
                    <td>
                      {u.id !== currentUser?.id && (
                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                          <button
                            className="btn-sm btn-ghost"
                            style={{ fontSize: '0.72rem', color: u.is_admin ? '#fca5a5' : '#86efac' }}
                            onClick={() => handleToggleAdmin(u.id)}
                            disabled={toggling === u.id || deleting === u.id}
                            type="button"
                          >
                            {toggling === u.id ? '...' : u.is_admin ? 'Remove Admin' : 'Make Admin'}
                          </button>
                          <button
                            className="btn-sm btn-ghost"
                            style={{ fontSize: '0.72rem', color: '#fca5a5' }}
                            onClick={() => handleDelete(u)}
                            disabled={toggling === u.id || deleting === u.id}
                            type="button"
                          >
                            {deleting === u.id ? '...' : 'Delete'}
                          </button>
                        </div>
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
