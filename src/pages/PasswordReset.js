import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { requireSupabaseClient } from '../utils/supabase';

const INVALID_LINK = 'This reset link is invalid or expired. Request a new one.';

// binge. emails the link itself, over its own SMTP (server/routes/passwordReset.js):
// Supabase's built-in sender only reaches the Supabase team's addresses. A server
// without SMTP answers { fallback: true }, and Supabase sends its own email.
async function sendResetLink(client, email) {
  const result = await api.post('/account/password-reset', { email });
  if (!result?.fallback) return;
  const { error } = await client.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  });
  if (error) throw error;
}

// binge.'s emails link to /reset-password?token_hash=…&type=recovery. The token
// works once, and React runs the effect twice in development, so each link is
// verified once and the answer shared.
let recoveryCheck = null;
function verifyRecoveryLink(client, tokenHash) {
  if (recoveryCheck?.tokenHash !== tokenHash) {
    recoveryCheck = { tokenHash, result: client.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' }) };
  }
  return recoveryCheck.result;
}

export default function PasswordReset({ recovery = false }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    if (!recovery) return;
    let active = true;
    async function checkSession() {
      try {
        const client = requireSupabaseClient();
        const params = new URLSearchParams(window.location.hash.slice(1));
        const query = new URLSearchParams(window.location.search);
        if (params.has('error') || query.has('error')) throw new Error(INVALID_LINK);
        const tokenHash = query.get('type') === 'recovery' ? query.get('token_hash') : null;
        if (tokenHash) {
          const { error: verifyError } = await verifyRecoveryLink(client, tokenHash);
          if (verifyError) throw new Error(INVALID_LINK);
          // Spent now; a reload keeps the session, so the address needn't carry it.
          window.history.replaceState(window.history.state, '', window.location.pathname);
        }
        // Supabase's own emails sign in through the address instead; getSession
        // waits for the SDK to process those tokens.
        const { data, error: sessionError } = await client.auth.getSession();
        if (sessionError || !data?.session) throw new Error(INVALID_LINK);
        if (active) setReady(true);
      } catch (err) {
        if (active) setError(err.message);
      }
    }
    checkSession();
    return () => { active = false; };
  }, [recovery]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    if (recovery && password !== confirmation) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      const client = requireSupabaseClient();
      if (recovery) {
        const { error: updateError } = await client.auth.updateUser({ password });
        if (updateError) throw updateError;
      } else {
        await sendResetLink(client, email.trim());
      }
      setPassword('');
      setConfirmation('');
      setComplete(true);
    } catch (err) {
      setError(err.message || 'Unable to reset your password. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page" style={{ backgroundImage: `url(${process.env.PUBLIC_URL}/landing-hero.webp)` }}>
      <div className="auth-card">
        <Link to="/" className="auth-logo">binge.</Link>
        <h1>{recovery ? 'Choose a new password' : 'Forgot password?'}</h1>
        <p className="auth-subtitle">{recovery ? 'Set a new password for your account.' : 'Enter your email to receive a password reset link.'}</p>
        {error && <div className="auth-error" role="alert">{error}</div>}
        {complete ? (
          <p role="status" style={{ color: '#fff' }}>{recovery ? 'Your password has been updated. You can now log in with your new password.' : 'If an account exists for this email, you’ll receive a password reset link. Check your inbox and spam folder.'}</p>
        ) : (
          <form className="auth-form" onSubmit={handleSubmit}>
            {recovery ? ready ? (
              <>
                <label>
                  <input aria-label="New password" placeholder="New password" type="password" autoComplete="new-password" minLength={6} required value={password} onChange={(event) => setPassword(event.target.value)} />
                </label>
                <label>
                  <input aria-label="Confirm new password" placeholder="Confirm new password" type="password" autoComplete="new-password" minLength={6} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
                </label>
              </>
            ) : !error && <p role="status">Checking your reset link…</p> : (
              <label>
                <input aria-label="Email" placeholder="Email" type="email" autoComplete="email" required autoFocus value={email} onChange={(event) => setEmail(event.target.value)} />
              </label>
            )}
            {(!recovery || ready) && <button type="submit" className="btn-primary btn-block" disabled={loading}>
              {loading ? 'Please wait…' : recovery ? 'Update password' : 'Send reset link'}
            </button>}
          </form>
        )}
        {recovery && error && <p className="auth-switch"><Link to="/forgot-password">Request a new reset link</Link></p>}
        <p className="auth-switch"><Link to="/login">Back to log in</Link></p>
      </div>
    </div>
  );
}
