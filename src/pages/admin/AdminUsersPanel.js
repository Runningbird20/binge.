import { useEffect, useMemo, useState } from 'react';
import { MagnifyingGlass, Plus, ShieldCheck, Trash, X } from '@phosphor-icons/react';
import { api } from '../../api';
import { useAuth } from '../../contexts/AuthContext';
import { createSupabaseUserAsAdmin } from '../../utils/supabaseData';
import { ago } from './AdminServers';

const NEW_USER = { username: '', email: '', password: '', bio: '', isAdmin: false };
const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'admins', label: 'Admins' },
  { id: 'active', label: 'Active this week' },
  { id: 'never', label: 'Never signed in' },
];

function CreateUser({ onCreated, onCancel }) {
  const [form, setForm] = useState(NEW_USER);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const created = await createSupabaseUserAsAdmin(form);
      if (form.isAdmin) {
        const updated = await api.patch(`/admin/users/${created.id}/toggle-admin`, {});
        created.is_admin = updated.is_admin;
      }
      onCreated(created, created.requiresEmailConfirmation
        ? `Created @${created.username}. They need to confirm their email before signing in.`
        : `Created @${created.username}.`);
      setForm(NEW_USER);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="adm-form adm-user-form" onSubmit={submit}>
      <label className="adm-field">
        <span>Username</span>
        <input type="text" value={form.username} onChange={update('username')} required autoComplete="off" />
      </label>
      <label className="adm-field">
        <span>Email</span>
        <input type="email" value={form.email} onChange={update('email')} required autoComplete="off" />
      </label>
      <label className="adm-field">
        <span>Password</span>
        <input type="password" value={form.password} onChange={update('password')} required minLength={6} placeholder="At least 6 characters" autoComplete="new-password" />
      </label>
      <label className="adm-field">
        <span>Bio (optional)</span>
        <input type="text" value={form.bio} onChange={update('bio')} />
      </label>
      <label className="adm-check adm-field--wide">
        <input type="checkbox" checked={form.isAdmin} onChange={update('isAdmin')} /> Make this account an admin
      </label>
      <div className="adm-form-actions">
        <button type="submit" className="st-btn st-btn--primary" disabled={saving}>{saving ? 'Creating…' : 'Create account'}</button>
        <button type="button" className="st-btn st-btn--ghost" onClick={onCancel} disabled={saving}>Cancel</button>
        {error && <span className="adm-error-inline" role="alert">{error}</span>}
      </div>
    </form>
  );
}

// User management, inside the admin panel: search, filters, create,
// promote/demote and delete — all through the existing service-role
// /api/admin/users routes.
export default function AdminUsersPanel() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    api.get('/admin/users')
      .then((list) => setUsers(Array.isArray(list) ? list : []))
      .catch((err) => { setError(err.message); setUsers([]); });
  }, []);

  const weekAgo = Date.now() - 7 * 86400000;
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (users || [])
      .filter((u) => !q || u.username?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q))
      .filter((u) => filter === 'all'
        || (filter === 'admins' && u.is_admin)
        || (filter === 'active' && u.last_sign_in_at && new Date(u.last_sign_in_at).getTime() > weekAgo)
        || (filter === 'never' && !u.last_sign_in_at))
      .sort((a, b) => String(b.last_sign_in_at || '').localeCompare(String(a.last_sign_in_at || '')));
  }, [users, query, filter, weekAgo]);

  async function toggleAdmin(target) {
    setBusy(target.id);
    setMessage('');
    try {
      const updated = await api.patch(`/admin/users/${target.id}/toggle-admin`, {});
      setUsers((list) => list.map((u) => (u.id === target.id ? { ...u, is_admin: updated.is_admin } : u)));
      setMessage(updated.is_admin ? `@${target.username} is now an admin.` : `@${target.username} is no longer an admin.`);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function remove(target) {
    setBusy(target.id);
    setMessage('');
    try {
      await api.delete(`/admin/users/${target.id}`);
      setUsers((list) => list.filter((u) => u.id !== target.id));
      setMessage(`Deleted @${target.username}.`);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(null);
      setConfirmDelete(null);
    }
  }

  const adminCount = (users || []).filter((u) => u.is_admin).length;

  return (
    <section className="adm-panel" aria-labelledby="adm-users-title">
      <div className="adm-panel-head">
        <div>
          <h3 id="adm-users-title">Users</h3>
          <p className="adm-muted">{users ? `${users.length} accounts · ${adminCount} admin${adminCount === 1 ? '' : 's'}` : 'Loading…'}</p>
        </div>
        <button type="button" className="st-btn st-btn--primary" onClick={() => setCreating((open) => !open)} aria-expanded={creating}>
          {creating ? <X size={16} weight="bold" aria-hidden="true" /> : <Plus size={16} weight="bold" aria-hidden="true" />}
          {creating ? 'Close' : 'New user'}
        </button>
      </div>

      {creating && (
        <CreateUser
          onCancel={() => setCreating(false)}
          onCreated={(created, note) => { setUsers((list) => [created, ...(list || [])]); setCreating(false); setMessage(note); }}
        />
      )}

      <div className="adm-users-toolbar">
        <label className="adm-search">
          <MagnifyingGlass size={16} weight="bold" aria-hidden="true" />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by username or email" aria-label="Search users" />
        </label>
        <div className="st-tabs st-tabs--sm" role="group" aria-label="Filter users">
          {FILTERS.map((entry) => (
            <button key={entry.id} type="button" className={`st-tab${filter === entry.id ? ' active' : ''}`} aria-pressed={filter === entry.id} onClick={() => setFilter(entry.id)}>
              {entry.label}
            </button>
          ))}
        </div>
      </div>

      {message && <p className="adm-note" role="status">{message}</p>}
      {error && <p className="adm-error-inline" role="alert">{error}</p>}
      {!users && <div className="adm-skeleton skeleton-block" aria-hidden="true" />}
      {users && visible.length === 0 && !error && <p className="adm-empty">No users match.</p>}

      {visible.length > 0 && (
        <table className="adm-table adm-users">
          <thead>
            <tr>
              <th scope="col">User</th>
              <th scope="col">Joined</th>
              <th scope="col">Last sign-in</th>
              <th scope="col">Profile</th>
              <th scope="col">Admin</th>
              <th scope="col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((u) => {
              const isMe = u.id === me?.id;
              const confirming = confirmDelete === u.id;
              return (
                <tr key={u.id} className={confirming ? 'confirming' : ''}>
                  <th scope="row">
                    <span className="adm-user">
                      <span className="adm-avatar" aria-hidden="true">{(u.username || u.email || '?').charAt(0).toUpperCase()}</span>
                      <span className="adm-user-text">
                        <span className="adm-user-name">
                          {u.username}
                          {u.is_admin && <ShieldCheck size={14} weight="fill" className="adm-shield" aria-label="admin" />}
                          {isMe && <span className="adm-you">you</span>}
                        </span>
                        <span className="adm-user-email">{u.email}</span>
                      </span>
                    </span>
                  </th>
                  <td title={u.created_at ? new Date(u.created_at).toLocaleString() : ''}>{u.created_at ? ago(u.created_at) : '—'}</td>
                  <td title={u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString() : ''}>
                    {u.last_sign_in_at ? ago(u.last_sign_in_at) : <span className="adm-muted">never</span>}
                  </td>
                  <td><span className={`adm-pill${u.is_public ? ' on' : ''}`}>{u.is_public ? 'Public' : 'Private'}</span></td>
                  <td>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={Boolean(u.is_admin)}
                      aria-label={`${u.username} is an admin`}
                      className={`set-switch set-switch--sm${u.is_admin ? ' on' : ''}`}
                      onClick={() => toggleAdmin(u)}
                      disabled={isMe || busy === u.id}
                      title={isMe ? 'You can’t change your own admin status' : u.is_admin ? 'Remove admin' : 'Make admin'}
                    ><span /></button>
                  </td>
                  <td className="adm-actions">
                    {!isMe && (confirming ? (
                      <span className="adm-confirm">
                        Delete @{u.username}?
                        <button type="button" className="st-btn st-btn--danger" onClick={() => remove(u)} disabled={busy === u.id}>{busy === u.id ? 'Deleting…' : 'Delete'}</button>
                        <button type="button" className="st-btn st-btn--ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
                      </span>
                    ) : (
                      <button type="button" className="pf-icon-btn" onClick={() => setConfirmDelete(u.id)} aria-label={`Delete ${u.username}`} title="Delete account">
                        <Trash size={15} weight="bold" />
                      </button>
                    ))}
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
