import { useState } from 'react';
import { deleteAccountProfile, signInWithSupabase } from '../utils/supabaseData';

// Confirms deleting a profile with the account password (Edit Profile page).
export default function DeleteProfileConfirm({ profile, userEmail, onCancel, onDeleted }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleConfirm(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      // Re-authenticating with the typed password is the verification check —
      // it throws if the password is wrong, and just re-confirms the same
      // session (harmless) if it's right.
      await signInWithSupabase({ email: userEmail, password });
      await deleteAccountProfile(profile.id);
      onDeleted();
    } catch (err) {
      setError(err.message || 'Unable to delete that profile.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="profile-delete-overlay" onClick={onCancel}>
      <form className="profile-delete-card" onClick={(event) => event.stopPropagation()} onSubmit={handleConfirm}>
        <h3>Delete "{profile.name}"?</h3>
        <p>This permanently removes this profile and everything saved under it — watchlist, ratings, and watch history. Enter your account password to confirm.</p>
        <input
          type="password"
          className="profile-picker-add-input"
          aria-label="Account password"
          placeholder="Account password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoFocus
        />
        {error && <p className="profile-picker-add-error">{error}</p>}
        <div className="profile-picker-add-actions">
          <button type="submit" className="btn-danger btn-sm" disabled={busy || !password}>
            {busy ? 'Deleting…' : 'Delete Profile'}
          </button>
          <button type="button" className="btn-ghost btn-sm" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
