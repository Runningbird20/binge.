import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Check, LockSimple, LockSimpleOpen } from '@phosphor-icons/react';
import { useAuth } from '../contexts/AuthContext';
import { requireSupabaseClient } from '../utils/supabase';
import { signInWithSupabase, updateAccountProfile } from '../utils/supabaseData';
import { fetchProfileLocks } from '../utils/profileLocks';
import { MATURITY_LEVELS, profileMaturity } from '../utils/kidsMode';
import ProfileAvatar, { AVATAR_COLORS, AVATAR_EMOJI } from '../components/ProfileAvatar';
import LoadingBar from '../components/LoadingBar';
import DeleteProfileConfirm from '../components/DeleteProfileConfirm';

// Back to the profile picker, still in Manage Profiles mode.
const MANAGE = '/profiles?manage=1';

// Edit Profile (/profiles/:profileId/edit), a page rather than a pop-up, as on
// Netflix: picture and name, maturity rating, profile lock, delete. Saving
// asks for the account password in a pop-up, so a kids profile can't change
// its own rating or lock.
export default function EditProfile() {
  const { profileId } = useParams();
  const navigate = useNavigate();
  const { user, profiles, activeProfile, profilesLoading, refreshProfiles } = useAuth();
  const profile = profiles?.find((entry) => entry.id === profileId);

  const [locks, setLocks] = useState(null); // { ids, available } once loaded
  const [lockError, setLockError] = useState('');
  const [name, setName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState(AVATAR_EMOJI[0]);
  const [avatarColor, setAvatarColor] = useState(AVATAR_COLORS[0]);
  const [maturity, setMaturity] = useState('all');
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [removeLock, setRemoveLock] = useState(false);
  const [confirming, setConfirming] = useState(false); // password pop-up open
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetchProfileLocks()
      .then(setLocks)
      .catch(() => setLockError('Couldn’t check this profile’s lock. Reload to try again.'));
  }, []);

  // Fill the form once the profile is known (and again if it changes).
  useEffect(() => {
    if (!profile) return;
    setName(profile.name || '');
    setAvatarUrl(profile.avatar_url || AVATAR_EMOJI[0]);
    setAvatarColor(profile.avatar_color || AVATAR_COLORS[0]);
    setMaturity(profileMaturity(profile));
  }, [profile]);

  if (profilesLoading || (!locks && !lockError)) {
    return <EditProfileShell><LoadingBar label="Loading profile…" /></EditProfileShell>;
  }
  if (!profile) {
    return (
      <EditProfileShell>
        <h1 className="edit-profile-title">Profile not found</h1>
        <p className="edit-profile-sub">It may have been deleted.</p>
        <Link to={MANAGE} className="profile-picker-manage">Back to profiles</Link>
      </EditProfileShell>
    );
  }

  const locked = Boolean(locks?.ids?.has(profile.id));
  const locksAvailable = Boolean(locks?.available);
  const lockChanged = Boolean(pin) || removeLock;
  // Only the main (default) profile can delete others, never itself.
  const canDelete = Boolean(activeProfile?.is_default) && !profile.is_default;
  // Check the form, then ask for the account password before saving.
  function requestSave(event) {
    event.preventDefault();
    setError('');
    if (!name.trim()) return setError('Give the profile a name.');
    if (pin && !/^[0-9]{4}$/.test(pin)) return setError('The PIN must be exactly four digits.');
    if (pin && pin !== confirm) return setError('The PINs don’t match.');
    setConfirming(true);
  }

  // Throws on a wrong password, so the pop-up can show the error.
  async function save(password) {
    setBusy(true);
    try {
      await signInWithSupabase({ email: user?.email, password });
      if (lockChanged) {
        const { error: lockFailure } = await requireSupabaseClient()
          .rpc('set_profile_lock', { target_profile: profile.id, new_pin: removeLock ? null : pin });
        if (lockFailure) throw lockFailure;
      }
      await updateAccountProfile(profile.id, { name: name.trim(), maturity, avatarUrl, avatarColor });
      await refreshProfiles();
      navigate(MANAGE);
    } catch (err) {
      setBusy(false);
      throw err;
    }
  }

  return (
    <EditProfileShell>
      <h1 className="edit-profile-title">Edit Profile</h1>
      <p className="edit-profile-sub">Picture, name, maturity rating and profile lock.</p>

      <form className="edit-profile-form" onSubmit={requestSave}>
        <section className="edit-profile-section edit-profile-identity">
          <ProfileAvatar profile={{ ...profile, avatar_url: avatarUrl, avatar_color: avatarColor }} size={128} />
          <div className="edit-profile-fields">
            <input
              aria-label="Name"
              placeholder="Name"
              type="text"
              className="profile-picker-add-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={40}
              autoComplete="off"
            />
            <p className="edit-profile-label">Picture</p>
            <div className="profile-avatar-picker" role="group" aria-label="Picture">
              {AVATAR_EMOJI.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className={`profile-avatar-picker-option${avatarUrl === emoji ? ' selected' : ''}`}
                  style={{ background: avatarColor }}
                  aria-pressed={avatarUrl === emoji}
                  onClick={() => setAvatarUrl(emoji)}
                >
                  {emoji}
                  {avatarUrl === emoji && <span className="profile-avatar-picker-check"><Check size={12} weight="bold" /></span>}
                </button>
              ))}
            </div>
            <p className="edit-profile-label">Background color</p>
            <div className="profile-color-picker" role="group" aria-label="Background color">
              {AVATAR_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`profile-color-picker-option${avatarColor === color ? ' selected' : ''}`}
                  style={{ background: color }}
                  aria-label={`Use ${color} background`}
                  aria-pressed={avatarColor === color}
                  onClick={() => setAvatarColor(color)}
                >
                  {avatarColor === color && <Check size={14} weight="bold" />}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="edit-profile-section">
          <h2 className="edit-profile-heading">Maturity rating</h2>
          <div className="edit-profile-chips" role="group" aria-label="Maturity rating">
            {MATURITY_LEVELS.map((level) => (
              <button
                key={level.value}
                type="button"
                className={`genre-chip${maturity === level.value ? ' active' : ''}`}
                aria-pressed={maturity === level.value}
                onClick={() => setMaturity(level.value)}
              >
                {level.label}
              </button>
            ))}
          </div>
          <p className="edit-profile-note">{MATURITY_LEVELS.find((level) => level.value === maturity)?.note}</p>
        </section>

        <section className="edit-profile-section">
          <h2 className="edit-profile-heading">Profile lock</h2>
          {lockError && <p className="profile-picker-add-error" role="alert">{lockError}</p>}
          {!lockError && !locksAvailable && <p className="edit-profile-note">Profile PINs are currently unavailable.</p>}
          {locksAvailable && (
            <>
              <p className="edit-profile-status">
                {locked
                  ? <><LockSimple size={16} weight="bold" aria-hidden="true" /> Locked with a PIN</>
                  : <><LockSimpleOpen size={16} weight="bold" aria-hidden="true" /> No PIN</>}
              </p>
              {!removeLock && (
                <div className="edit-profile-pins">
                  <label className="edit-profile-label">
                    <input aria-label={locked ? 'New four-digit PIN' : 'Four-digit PIN'} className="profile-picker-add-input" type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))} placeholder={locked ? 'New four-digit PIN (leave blank to keep)' : 'Four-digit PIN (optional)'} />
                  </label>
                  {pin && (
                    <label className="edit-profile-label">
                      <input aria-label="Confirm PIN" placeholder="Confirm PIN" className="profile-picker-add-input" type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={confirm} onChange={(event) => setConfirm(event.target.value.replace(/\D/g, ''))} />
                    </label>
                  )}
                </div>
              )}
              {locked && (
                <label className="edit-profile-check">
                  <input type="checkbox" checked={removeLock} onChange={(event) => { setRemoveLock(event.target.checked); setPin(''); setConfirm(''); }} />
                  Remove the profile lock
                </label>
              )}
            </>
          )}
        </section>

        {error && <p className="profile-picker-add-error edit-profile-error" role="alert">{error}</p>}

        <div className="edit-profile-actions">
          <button type="submit" className="btn-primary edit-profile-pill" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          <Link to={MANAGE} className="profile-picker-manage edit-profile-cancel">Cancel</Link>
          {canDelete && (
            <button type="button" className="btn-danger edit-profile-pill edit-profile-delete" disabled={busy} onClick={() => setDeleting(true)}>
              Delete profile
            </button>
          )}
        </div>
      </form>

      {confirming && (
        <ConfirmPassword
          onCancel={() => setConfirming(false)}
          onConfirm={save}
        />
      )}
      {deleting && (
        <DeleteProfileConfirm
          profile={profile}
          userEmail={user?.email}
          onCancel={() => setDeleting(false)}
          onDeleted={async () => { await refreshProfiles(); navigate(MANAGE); }}
        />
      )}
    </EditProfileShell>
  );
}

// "Enter your account password to save" pop-up.
function ConfirmPassword({ onCancel, onConfirm }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onConfirm(password);
    } catch (err) {
      setError(err.message || 'Couldn’t save this profile.');
      setBusy(false);
    }
  }

  return (
    <div className="profile-delete-overlay" onClick={busy ? undefined : onCancel}>
      <form className="profile-delete-card" role="dialog" aria-modal="true" aria-labelledby="confirm-password-title" onClick={(event) => event.stopPropagation()} onSubmit={submit}>
        <h3 id="confirm-password-title">Confirm it’s you</h3>
        <p>Enter your account password to save these changes.</p>
        <input
          type="password"
          className="profile-picker-add-input"
          aria-label="Account password"
          placeholder="Account password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoFocus
        />
        {error && <p className="profile-picker-add-error" role="alert">{error}</p>}
        <div className="profile-picker-add-actions">
          <button type="submit" className="btn-primary" disabled={busy || !password}>{busy ? 'Saving…' : 'Save changes'}</button>
          <button type="button" className="btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

function EditProfileShell({ children }) {
  return (
    <div className="profile-picker-page edit-profile-page" style={{ backgroundImage: `url(${process.env.PUBLIC_URL}/landing-hero.webp)` }}>
      <div className="profile-picker-overlay" aria-hidden="true" />
      <main className="edit-profile">{children}</main>
    </div>
  );
}
