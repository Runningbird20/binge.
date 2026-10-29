import LoadingBar from '../components/LoadingBar';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Baby, Check, LockSimple, PencilSimple, Smiley, Student } from '@phosphor-icons/react';
import { useAuth } from '../contexts/AuthContext';
import ProfileSecurityDialog from '../components/ProfileSecurityDialog';
import { fetchProfileLocks } from '../utils/profileLocks';
import ProfileAvatar from '../components/ProfileAvatar';
import ProfileCreationWizard from '../components/ProfileCreationWizard';
import { MATURITY_LEVELS, profileMaturity } from '../utils/kidsMode';

// Each restricted maturity level has its own pill above the avatar.
const AGE_ICONS = { toddler: Baby, kids: Smiley, teens: Student };

function AgeBadge({ level }) {
  const Icon = AGE_ICONS[level];
  // The slot is always there so avatars line up whether or not a tile has a pill.
  return (
    <span className="profile-picker-age-slot" aria-hidden="true">
      {Icon && (
        <span className={`profile-picker-age profile-picker-age--${level}`}>
          <Icon size={15} weight="bold" /> {MATURITY_LEVELS.find((entry) => entry.value === level).label}
        </span>
      )}
    </span>
  );
}

// One profile. In manage mode the avatar dims under a pencil and a click
// opens its Edit Profile page (Netflix's "Manage Profiles"); otherwise a
// click picks it. A
// profile with a PIN shows a lock in the avatar's corner. Only hover (or
// keyboard focus) highlights a tile, not the profile currently in use.
function ProfileTile({ profile, managing, locked, onClick }) {
  const level = profileMaturity(profile);
  const age = level === 'all' ? '' : `, ${MATURITY_LEVELS.find((entry) => entry.value === level).label} profile`;
  const label = managing ? `Edit ${profile.name}` : `${profile.name}${age}${locked ? ', locked with a PIN' : ''}`;
  return (
    <div className={`profile-picker-tile${managing ? ' managing' : ''}`}>
      <button type="button" className="profile-picker-tile-btn" onClick={onClick} aria-label={label}>
        <AgeBadge level={level} />
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
      </button>
    </div>
  );
}

export default function ProfilePicker() {
  const { profiles, switchProfile, addProfile, profilesLoading } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [securityTarget, setSecurityTarget] = useState(null);
  // Edit Profile returns here with ?manage=1, still managing.
  const [managing, setManaging] = useState(() => params.get('manage') === '1');
  const [locks, setLocks] = useState(null);
  const [lockError, setLockError] = useState('');
  async function loadLocks() {
    try {
      const result = await fetchProfileLocks();
      setLocks(result.ids);
      setLockError('');
    } catch { setLocks(null); setLockError('Unable to load profile locks. Please try again.'); }
  }
  useEffect(() => { loadLocks(); }, []);
  // Esc leaves manage mode.
  useEffect(() => {
    if (!managing) return undefined;
    function onKey(event) { if (event.key === 'Escape') setManaging(false); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [managing]);

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
                  if (managing) navigate(`/profiles/${profile.id}/edit`);
                  else if (locks.has(profile.id)) setSecurityTarget(profile);
                  else switchProfile(profile.id);
                }}
              />
            ))}
            {/* Adding a profile is part of managing them, as on Netflix. */}
            {managing && (
              <button type="button" className="profile-picker-tile profile-picker-tile--add" onClick={() => setWizardOpen(true)}>
                <AgeBadge level="all" />
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

      {securityTarget && (
        <ProfileSecurityDialog profile={securityTarget} onCancel={() => setSecurityTarget(null)} onUnlock={() => switchProfile(securityTarget.id)} />
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
