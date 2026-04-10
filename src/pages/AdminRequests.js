import { useState, useEffect } from 'react';
import Navbar from '../components/Navbar';
import { api } from '../api';

const STATUS_COLORS = {
  pending:  { bg: 'rgba(250,204,21,0.12)',  border: 'rgba(250,204,21,0.3)',  color: '#fde68a' },
  approved: { bg: 'rgba(34,197,94,0.12)',   border: 'rgba(34,197,94,0.3)',   color: '#86efac' },
  rejected: { bg: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.3)', color: '#fca5a5' },
};

const MEDIA_ICONS = { movie: '🎬', tv_show: '📺', book: '📚' };

export default function AdminRequests() {
  const [requests, setRequests]   = useState([]);
  const [filter, setFilter]       = useState('pending');
  const [loading, setLoading]     = useState(true);
  const [actionId, setActionId]   = useState(null);
  const [adminNote, setAdminNote] = useState('');
  const [noteFor, setNoteFor]     = useState(null);
  const [error, setError]         = useState('');

  useEffect(() => {
    let cancelled = false;

    async function fetchRequests() {
      setLoading(true);
      try {
        const params = filter !== 'all' ? `?status=${filter}` : '';
        const data = await api.get(`/requests/admin${params}`);
        if (!cancelled) {
          setRequests(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchRequests();

    return () => {
      cancelled = true;
    };
  }, [filter]);

  async function updateStatus(id, status) {
    setActionId(id);
    try {
      const note = noteFor === id ? adminNote : '';
      await api.patch(`/requests/${id}`, { status, admin_note: note });
      setRequests(prev => prev.map(r => r.id === id ? { ...r, status, admin_note: note } : r));
      setNoteFor(null);
      setAdminNote('');
    } catch (err) {
      setError(err.message);
    } finally {
      setActionId(null);
    }
  }

  const counts = requests.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content">
        <div className="page-header">
          <h1>Media Requests</h1>
          <p style={{ color: '#888', margin: '0.4rem 0 0 0' }}>
            Review user submissions for media to add to the site.
          </p>
        </div>

        {error && (
          <div className="auth-error" style={{ marginBottom: '1rem' }}>{error}</div>
        )}

        {/* Filter tabs */}
        <div className="tabs" style={{ marginBottom: '1.5rem' }}>
          {['pending', 'approved', 'rejected', 'all'].map(s => (
            <button
              key={s}
              className={`tab-btn ${filter === s ? 'active' : ''}`}
              onClick={() => setFilter(s)}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
              {s !== 'all' && counts[s] ? ` (${counts[s]})` : ''}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="loading-state">Loading requests...</div>
        ) : requests.length === 0 ? (
          <div className="empty-state">
            <p>No {filter !== 'all' ? filter : ''} requests.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {requests.map(req => {
              const sc = STATUS_COLORS[req.status];
              return (
                <div key={req.id} className="watchlist-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.75rem' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '1.2rem' }}>{MEDIA_ICONS[req.media_type]}</span>
                        <strong style={{ color: '#fff', fontSize: '1rem' }}>{req.title}</strong>
                        {req.year && <span style={{ color: '#666', fontSize: '0.85rem' }}>{req.year}</span>}
                        <span
                          style={{
                            fontSize: '0.72rem', fontWeight: 700, padding: '0.15rem 0.5rem',
                            borderRadius: '999px', background: sc.bg, border: `1px solid ${sc.border}`, color: sc.color,
                            textTransform: 'uppercase', letterSpacing: '0.05em',
                          }}
                        >
                          {req.status}
                        </span>
                      </div>
                      <div style={{ marginTop: '0.35rem', fontSize: '0.82rem', color: '#888' }}>
                        Requested by <strong style={{ color: '#bbb' }}>@{req.username}</strong>
                        {' · '}{new Date(req.created_at).toLocaleDateString()}
                        {' · '}{req.media_type.replace('_', ' ')}
                      </div>
                      {req.reason && (
                        <div style={{ marginTop: '0.4rem', fontSize: '0.85rem', color: '#aaa', fontStyle: 'italic' }}>
                          "{req.reason}"
                        </div>
                      )}
                      {req.admin_note && (
                        <div style={{ marginTop: '0.4rem', fontSize: '0.82rem', color: '#888' }}>
                          Admin note: {req.admin_note}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    {req.status === 'pending' && (
                      <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                        <button
                          className="btn-primary btn-sm"
                          disabled={actionId === req.id}
                          onClick={() => updateStatus(req.id, 'approved')}
                        >
                          Approve
                        </button>
                        <button
                          className="btn-secondary btn-sm"
                          disabled={actionId === req.id}
                          onClick={() => setNoteFor(noteFor === req.id ? null : req.id)}
                        >
                          Reject
                        </button>
                      </div>
                    )}
                    {req.status !== 'pending' && (
                      <button
                        className="btn-ghost btn-sm"
                        onClick={() => updateStatus(req.id, 'pending')}
                        disabled={actionId === req.id}
                      >
                        Reset to pending
                      </button>
                    )}
                  </div>

                  {/* Rejection note input */}
                  {noteFor === req.id && (
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <input
                        className="search-input"
                        style={{ flex: 1, padding: '0.45rem 0.75rem', fontSize: '0.85rem' }}
                        placeholder="Optional note to user (e.g. Already on the site)"
                        value={adminNote}
                        onChange={e => setAdminNote(e.target.value)}
                      />
                      <button
                        className="btn-ghost btn-sm"
                        style={{ color: '#f08080' }}
                        disabled={actionId === req.id}
                        onClick={() => updateStatus(req.id, 'rejected')}
                      >
                        Confirm Reject
                      </button>
                      <button className="btn-ghost btn-sm" onClick={() => setNoteFor(null)}>
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
