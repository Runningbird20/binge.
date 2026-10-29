import LoadingBar from '../components/LoadingBar';
import { useEffect, useState } from 'react';
import { Plus, Baby, Check, LockSimple, PencilSimple } from '@phosphor-icons/react';
import { useAuth } from '../contexts/AuthContext';
import { deleteAccountProfile, signInWithSupabase } from '../utils/supabaseData';
import ProfileSecurityDialog from '../components/ProfileSecurityDialog';
import { fetchProfileLocks } from '../utils/profileLocks';
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

// One profile. In manage mode the avatar dims under a pencil and a click
// edits it (Netflix's "Manage Profiles"); otherwise a click picks it. A
// profile with a PIN shows a lock in the avatar's corner. Only hover (or
// keyboard focus) highlights a tile, not the profile currently in use.
function ProfileTile({ profile, managing, locked, onClick }) {
  const label = managing ? `Edit ${profile.name}` : `${profile.name}${locked ? ', locked with a PIN' : ''}`;
  return (
    <div className={`profile-picker-tile${managing ? ' managing' : ''}`}>
      <button type="button" className="profile-picker-tile-btn" onClick={onClick} aria-label={label}>
        <span className="profile-picker-avatar-wrap">
          <ProfileAvatar profile={profile} size={96} />
          {locked && !managing && <LockSimple className="profile-picker-lock" size={16} weight="bold" aria-hidden="true" />}
          {managing && (
            <span className="profile-picker-edit-mark" aria-hidden="true">
              <PencilSimple size={30} />
            </span>
          )}
        </span>
        <span className="profile-picker-name">{profile.name}</span>
        {profile.is_kids && (
          <span className="profile-picker-kids-badge"><Baby size={12} weight="bold" /> Kids</span>
        )}
      </button>
    </div>
  );
}

export default function ProfilePicker() {
  const { user, profiles, activeProfile, switchProfile, addProfile, profilesLoading, refreshProfiles } = useAuth();
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [securityTarget, setSecurityTarget] = useState(null);
  const [managing, setManaging] = useState(false);
  const [locks, setLocks] = useState(null);
  const [lockError, setLockError] = useState('');
  const [locksAvailable, setLocksAvailable] = useState(false);
  async function loadLocks() {
    try {
      const result = await fetchProfileLocks();
      setLocks(result.ids);
      setLocksAvailable(result.available);
      setLockError('');
    } catch { setLocks(null); setLockError('Unable to load profile locks. Please try again.'); }
  }
  useEffect(() => { loadLocks(); }, []);
  // Esc leaves manage mode (unless a dialog is open; it handles Esc itself).
  useEffect(() => {
    if (!managing) return undefined;
    function onKey(event) { if (event.key === 'Escape' && !securityTarget && !deleteTarget) setManaging(false); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [managing, securityTarget, deleteTarget]);

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

        {lockError && <p className="profile-picker-error" role="alert">{lockError} <button type="button" className="btn-ghost" onClick={loadLocks}>Retry</button></p>}
        {profilesLoading || (!locks && !lockError) ? (
          <LoadingBar label="Loading profiles…" />
        ) : locks ? (
          <div className="profile-picker-grid">
            {profiles.map((profile) => (
              <ProfileTile
                key={profile.id}
                profile={profile}
                managing={managing}
                locked={locks.has(profile.id)}
                onClick={() => {
                  if (managing) setSecurityTarget({ profile, editing: true });
                  else if (locks.has(profile.id)) setSecurityTarget({ profile, editing: false });
                  else switchProfile(profile.id);
                }}
              />
            ))}
            {/* Adding a profile is part of managing them, as on Netflix. */}
            {managing && (
              <button type="button" className="profile-picker-tile profile-picker-tile--add" onClick={() => setWizardOpen(true)}>
                <span className="profile-picker-avatar profile-picker-avatar--add">
                  <Plus size={32} weight="bold" aria-hidden="true" />
                </span>
                <span className="profile-picker-name">Add Profile</span>
              </button>
            )}
          </div>
        ) : null}

        {locks && !profilesLoading && (managing ? (
          <button type="button" className="profile-picker-manage profile-picker-manage--done" onClick={() => setManaging(false)}>
            <Check size={18} weight="bold" aria-hidden="true" /> Done
          </button>
        ) : (
          <button type="button" className="profile-picker-manage" onClick={() => setManaging(true)}>
            <PencilSimple size={18} aria-hidden="true" /> Manage Profiles
          </button>
        ))}

      </div>

      {securityTarget && <ProfileSecurityDialog
        profile={securityTarget.profile} email={user?.email} editing={securityTarget.editing} locksAvailable={locksAvailable}
        locked={locks?.has(securityTarget.profile.id)} onCancel={() => setSecurityTarget(null)}
        onSaved={async () => { await refreshProfiles(); await loadLocks(); setSecurityTarget(null); }}
        onUnlock={() => switchProfile(securityTarget.profile.id)}
        onDelete={canManage && !securityTarget.profile.is_default
          ? () => { setDeleteTarget(securityTarget.profile); setSecurityTarget(null); }
          : null}
      />}
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
