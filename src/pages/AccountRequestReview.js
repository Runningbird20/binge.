import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Check, Copy } from '@phosphor-icons/react';
import LoadingBar from '../components/LoadingBar';
import { decideAccountRequest, fetchAccountRequest } from '../utils/accountRequests';

const BACKGROUND = { backgroundImage: `url(${process.env.PUBLIC_URL}/landing-hero.webp)` };

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

// /account-requests/review?token=…, the link in the admin's request email
// (docs/invite-only.md). Holding the token is the permission, so it works
// without signing in. Approve and Deny are buttons (a POST), so an email
// client that opens links by itself can't decide anything.
export default function AccountRequestReview() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [request, setRequest] = useState(null);
  const [error, setError] = useState('');
  const [approval, setApproval] = useState(null); // { emailed, inviteLink } just now
  const [busy, setBusy] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchAccountRequest(token)
      .then((next) => { if (!cancelled) setRequest(next); })
      .catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [token]);

  async function decide(decision) {
    setBusy(decision);
    setError('');
    try {
      const result = await decideAccountRequest(token, decision);
      setRequest(result.request);
      if (decision === 'approve' && !result.already) setApproval({ emailed: result.emailed, inviteLink: result.inviteLink });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="auth-page" style={BACKGROUND}>
      <div className="auth-card">
        <Link to="/" className="auth-logo">binge.</Link>
        <h1>Account request</h1>
        {error && <div className="auth-error" role="alert">{error}</div>}
        {!request && !error && <LoadingBar label="Loading the request…" />}
        {request && (
          <>
            <p className="auth-subtitle">
              <strong>{request.name}</strong> ({request.email}) asked for an account on {fmtDate(request.createdAt)}.
            </p>
            {request.note && <p className="auth-subtitle">“{request.note}”</p>}
            <RequestStatus request={request} approval={approval} busy={busy} onDecide={decide} />
          </>
        )}
      </div>
    </div>
  );
}

function RequestStatus({ request, approval, busy, onDecide }) {
  if (request.status === 'pending') {
    return (
      <div className="auth-form">
        <button type="button" className="btn-primary btn-block" disabled={Boolean(busy)} onClick={() => onDecide('approve')}>
          {busy === 'approve' ? 'Approving…' : 'Approve'}
        </button>
        <button type="button" className="btn-ghost btn-block" disabled={Boolean(busy)} onClick={() => onDecide('deny')}>
          {busy === 'deny' ? 'Denying…' : 'Deny'}
        </button>
      </div>
    );
  }
  if (request.status === 'denied') return <p className="settings-success" role="status">Denied on {fmtDate(request.decidedAt)}. They weren’t emailed.</p>;
  if (request.status === 'used') return <p className="settings-success" role="status">Approved. They created their account on {fmtDate(request.usedAt)}.</p>;
  if (approval && !approval.emailed) return <InviteLink link={approval.inviteLink} email={request.email} />;
  return (
    <p className="settings-success" role="status">
      Approved{approval ? '' : ` on ${fmtDate(request.decidedAt)}`}. We emailed {request.email} a link to create their account.
    </p>
  );
}

// When the email couldn't go out (no SMTP set up, or it was refused): the
// link to pass on by hand.
export function InviteLink({ link, email }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch { /* the link is shown to copy by hand */ }
  }
  return (
    <div className="auth-form" role="status">
      <p className="auth-subtitle">Approved, but the email to {email} didn’t go out. Send them this link to create their account:</p>
      <p className="install-how install-url">{link}</p>
      <button type="button" className="btn-ghost btn-block" onClick={copy}>
        {copied ? <><Check size={16} weight="bold" aria-hidden="true" /> Link copied</> : <><Copy size={16} weight="bold" aria-hidden="true" /> Copy the link</>}
      </button>
    </div>
  );
}
