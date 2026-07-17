import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Baby, X } from '@phosphor-icons/react';
import { useAuth } from '../contexts/AuthContext';
import { deleteAccountProfile, signInWithSupabase } from '../utils/supabaseData';
import ProfileAvatar from '../components/ProfileAvatar';
import ProfileCreationWizard from '../components/ProfileCreationWizard';

function DeleteProfileConfirm({ profile, userEmail, onCancel, onDeleted }) {
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

function ProfileTile({ profile, active, canDelete, onClick, onRequestDelete }) {
  return (
    <div className={`profile-picker-tile${active ? ' active' : ''}`}>
      <button type="button" className="profile-picker-tile-btn" onClick={onClick}>
        <ProfileAvatar profile={profile} size={96} />
        <span className="profile-picker-name">{profile.name}</span>
        {profile.is_kids && (
          <span className="profile-picker-kids-badge"><Baby size={12} weight="bold" /> Kids</span>
        )}
      </button>
      {canDelete && (
        <button
          type="button"
          className="profile-picker-delete-btn"
          title={`Delete ${profile.name}`}
          aria-label={`Delete ${profile.name}`}
          onClick={(event) => { event.stopPropagation(); onRequestDelete(profile); }}
        >
          <X size={14} weight="bold" />
        </button>
      )}
    </div>
  );
}

export default function ProfilePicker() {
  const { user, profiles, activeProfile, switchProfile, addProfile, profilesLoading, refreshProfiles } = useAuth();
  const navigate = useNavigate();
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  // Only the default profile can delete other profiles — matches the
  // "main account holder" framing (the default profile is the one
  // auto-created for whoever signed up the account).
  const canManage = Boolean(activeProfile?.is_default);

  return (
    <div
      className="profile-picker-page"
      style={{ backgroundImage: `url(${process.env.PUBLIC_URL}/landing-hero.webp)` }}
    >
      <div className="profile-picker-overlay" aria-hidden="true" />
      <div className="profile-picker-content">
        <h1 className="profile-picker-title">Who's watching?</h1>

        {profilesLoading ? (
          <p className="profile-picker-loading">Loading profiles…</p>
        ) : (
          <div className="profile-picker-grid">
            {profiles.map((profile) => (
              <ProfileTile
                key={profile.id}
                profile={profile}
                active={activeProfile?.id === profile.id}
                canDelete={canManage && !profile.is_default}
                onClick={() => switchProfile(profile.id)}
                onRequestDelete={setDeleteTarget}
              />
            ))}
            <button type="button" className="profile-picker-tile profile-picker-tile--add" onClick={() => setWizardOpen(true)}>
              <span className="profile-picker-avatar profile-picker-avatar--add">
                <Plus size={32} weight="bold" aria-hidden="true" />
              </span>
              <span className="profile-picker-name">Add Profile</span>
            </button>
          </div>
        )}

        <button type="button" className="btn-secondary profile-picker-back" onClick={() => navigate(-1)}>
          Back
        </button>
      </div>

      {deleteTarget && (
        <DeleteProfileConfirm
          profile={deleteTarget}
          userEmail={user?.email}
          onCancel={() => setDeleteTarget(null)}
          onDeleted={() => { setDeleteTarget(null); refreshProfiles(); }}
        />
      )}

      {wizardOpen && (
        <ProfileCreationWizard
          onCreate={addProfile}
          onCancel={() => setWizardOpen(false)}
          onFinish={(profile) => switchProfile(profile.id)}
        />
      )}
    </div>
  );
}
