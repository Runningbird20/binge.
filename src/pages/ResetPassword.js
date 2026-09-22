import { useState } from 'react';
import { Link } from 'react-router-dom';
import { backendRequest } from '../utils/backendClient';

export default function ResetPassword() {
  const [token] = useState(() => window.location.hash.slice(1));
  const [value, setValue] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setMessage('');
    const result = await backendRequest(token ? '/backend/auth/password-reset/complete' : '/backend/auth/password-reset', {
      method: 'POST', body: token ? { token, password: value } : { email: value },
    });
    setBusy(false);
    if (result.error) { setMessage(result.error.message); return; }
    setDone(true);
    if (token) window.history.replaceState(null, '', window.location.pathname);
    setMessage(token ? 'Password updated. Sign in with your new password.' : 'If an account exists for this email, a reset link has been sent.');
  }
  return <div className="auth-page"><div className="auth-card">
    <h1>{token ? 'Choose a new password' : 'Reset your password'}</h1>
    {message && <p role="status">{message}</p>}
    {!done && <form onSubmit={submit}>
      <label>{token ? 'New password' : 'Email'}<input type={token ? 'password' : 'email'} value={value} onChange={e => setValue(e.target.value)} required minLength={token ? 8 : undefined} autoComplete={token ? 'new-password' : 'email'} /></label>
      <button className="btn-primary btn-block" disabled={busy}>{busy ? 'Please wait…' : token ? 'Update password' : 'Send reset link'}</button>
    </form>}
    <p className="auth-switch"><Link to="/login">Back to login</Link></p>
  </div></div>;
}
