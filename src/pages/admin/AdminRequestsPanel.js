import { useEffect, useState } from 'react';
import LoadingBar from '../../components/LoadingBar';
import { decideAdminAccountRequest, fetchAdminAccountRequests } from '../../utils/accountRequests';
import { InviteLink } from '../AccountRequestReview';
import { ago } from './AdminServers';

const STATUS = { pending: 'Waiting', approved: 'Approved', used: 'Joined', denied: 'Denied' };

// Admin → Requests: everyone who asked for an account on /signup (invite-only
// sign-up, docs/invite-only.md). Each request also emails the admin a review
// link; this list is the same decision for anyone signed in as an admin, and
// what's left when an email didn't arrive.
export default function AdminRequestsPanel({ onPendingChange }) {
  const [requests, setRequests] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const [approved, setApproved] = useState(null); // { email, emailed, inviteLink }
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetchAdminAccountRequests()
      .then(({ requests: list }) => setRequests(list || []))
      .catch((err) => { setError(err.message); setRequests([]); });
  }, []);

  useEffect(() => {
    if (requests) onPendingChange?.(requests.filter((row) => row.status === 'pending').length);
  }, [requests, onPendingChange]);

  async function decide(row, decision) {
    setBusy(row.id);
    setMessage('');
    setApproved(null);
    try {
      const result = await decideAdminAccountRequest(row.id, decision);
      setRequests((list) => list.map((entry) => (entry.id === row.id ? result.request : entry)));
      if (decision === 'approve' && !result.already) setApproved({ email: row.email, emailed: result.emailed, inviteLink: result.inviteLink });
      else setMessage(decision === 'deny' ? `Denied ${row.email}.` : `That request was already ${STATUS[result.request.status].toLowerCase()}.`);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(null);
    }
  }

  const pending = (requests || []).filter((row) => row.status === 'pending').length;

  return (
    <section className="adm-panel" aria-labelledby="adm-requests-title">
      <div className="adm-panel-head">
        <div>
          <h3 id="adm-requests-title">Account requests</h3>
          <p className="adm-muted">
            {requests ? `${pending} waiting · ${requests.length} in all` : 'Loading…'}. Approving emails them a link to create their account.
          </p>
        </div>
      </div>
      {approved && (approved.emailed
        ? <p className="adm-note" role="status">Approved. We emailed {approved.email} a link to create their account.</p>
        : <InviteLink link={approved.inviteLink} email={approved.email} />)}
      {message && <p className="adm-note" role="status">{message}</p>}
      {error && <p className="adm-error-inline" role="alert">{error}</p>}
      {!requests && <LoadingBar />}
      {requests && requests.length === 0 && !error && (
        <p className="adm-empty">No requests yet. People ask on the sign-up page, and each request emails you too.</p>
      )}
      {requests && requests.length > 0 && (
        <table className="adm-table">
          <thead>
            <tr>
              <th scope="col">Who</th>
              <th scope="col">Note</th>
              <th scope="col">Asked</th>
              <th scope="col">Status</th>
              <th scope="col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {requests.map((row) => (
              <tr key={row.id}>
                <th scope="row">
                  {row.name}
                  <span className="adm-user-email">{row.email}</span>
                </th>
                <td>{row.note || <span className="adm-muted">—</span>}</td>
                <td title={new Date(row.createdAt).toLocaleString()}>{ago(row.createdAt)}</td>
                <td><span className={`adm-pill${row.status === 'used' || row.status === 'approved' ? ' on' : ''}`}>{STATUS[row.status] || row.status}</span></td>
                <td className="adm-actions">
                  {row.status === 'pending' && (
                    <span className="adm-confirm">
                      <button type="button" className="st-btn st-btn--primary" onClick={() => decide(row, 'approve')} disabled={busy === row.id}>
                        {busy === row.id ? 'Saving…' : 'Approve'}
                      </button>
                      <button type="button" className="st-btn st-btn--ghost" onClick={() => decide(row, 'deny')} disabled={busy === row.id}>Deny</button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
