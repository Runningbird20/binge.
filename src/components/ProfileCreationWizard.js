import { useState } from 'react';
import { Check } from '@phosphor-icons/react';
import { AVATAR_COLORS, AVATAR_EMOJI } from './ProfileAvatar';

function ProgressDots({ current, total }) {
  return (
    <div className="ob-dots">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`ob-dot${i === current ? ' active' : ''}`} />
      ))}
    </div>
  );
}

const TOTAL_STEPS = 3;

// Netflix-style "Add Profile" flow: picture → name → permissions → done.
// Deliberately no rating/onboarding step in here — creating a profile should
// be as fast as Netflix's own flow, not a detour into seeding recommendations.
export default function ProfileCreationWizard({ onCreate, onFinish, onCancel }) {
  const [step, setStep] = useState(0); // 0=picture 1=name 2=permissions
  const [avatarUrl, setAvatarUrl] = useState(AVATAR_EMOJI[0]);
  const [avatarColor, setAvatarColor] = useState(AVATAR_COLORS[0]);
  const [name, setName] = useState('');
  const [isKids, setIsKids] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  async function handleCreate() {
    if (!name.trim()) return;
    setCreating(true);
    setCreateError('');
    try {
      const created = await onCreate({ name: name.trim(), isKids, avatarUrl, avatarColor });
      onFinish(created);
    } catch (err) {
      setCreateError(err.message || 'Unable to create that profile.');
      setCreating(false);
    }
  }

  return (
    <div className="onboarding-overlay" onClick={onCancel}>
      <div className="onboarding-modal" onClick={(e) => e.stopPropagation()}>
        <ProgressDots current={step} total={TOTAL_STEPS} />

        {step === 0 && (
          <>
            <h2>Choose a picture</h2>
            <div className="profile-avatar-picker profile-avatar-picker--wizard">
              {AVATAR_EMOJI.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className={`profile-avatar-picker-option${avatarUrl === emoji ? ' selected' : ''}`}
                  style={{ background: avatarColor }}
                  onClick={() => setAvatarUrl(emoji)}
                >
                  {emoji}
                  {avatarUrl === emoji && <span className="profile-avatar-picker-check"><Check size={12} weight="bold" /></span>}
                </button>
              ))}
            </div>
            <p className="profile-picker-add-label">Background color</p>
            <div className="profile-color-picker">
              {AVATAR_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`profile-color-picker-option${avatarColor === color ? ' selected' : ''}`}
                  style={{ background: color }}
                  aria-label={`Use ${color} background`}
                  onClick={() => setAvatarColor(color)}
                >
                  {avatarColor === color && <Check size={14} weight="bold" />}
                </button>
              ))}
            </div>
            <div className="onboarding-actions">
              <button className="btn-primary" type="button" onClick={() => setStep(1)}>Continue →</button>
              <button className="btn-ghost" type="button" onClick={onCancel}>Cancel</button>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h2>What's this profile called?</h2>
            <input
              type="text"
              className="profile-picker-add-input profile-wizard-name-input"
              placeholder="Profile name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
              maxLength={40}
              onKeyDown={(event) => { if (event.key === 'Enter' && name.trim()) setStep(2); }}
            />
            <div className="onboarding-actions">
              <button className="btn-primary" type="button" onClick={() => setStep(2)} disabled={!name.trim()}>Continue →</button>
              <button className="btn-ghost" type="button" onClick={onCancel}>Cancel</button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2>Set permissions</h2>
            <label className="profile-picker-kids-toggle profile-wizard-kids-toggle">
              <input type="checkbox" checked={isKids} onChange={(event) => setIsKids(event.target.checked)} />
              Kids profile — only shows titles rated G / PG / TV-Y / TV-Y7 / TV-G / TV-PG
            </label>
            {createError && <p className="profile-picker-add-error">{createError}</p>}
            <div className="onboarding-actions">
              <button className="btn-primary" type="button" onClick={handleCreate} disabled={creating}>
                {creating ? 'Creating…' : 'Create Profile'}
              </button>
              <button className="btn-ghost" type="button" onClick={onCancel} disabled={creating}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
