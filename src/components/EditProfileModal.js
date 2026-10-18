import { useState } from 'react';
import { Check } from '@phosphor-icons/react';
import { updateAccountProfile } from '../utils/supabaseData';
import { AVATAR_COLORS, AVATAR_EMOJI } from './ProfileAvatar';

// Sub-profiles can only rename themselves and change their own picture —
// everything else (password, email, admin/dev role) lives on the account
// and is only reachable from the default profile's full Account Settings.
export default function EditProfileModal({ profile, onClose, onSaved }) {
  const [name, setName] = useState(profile.name);
  const [avatarUrl, setAvatarUrl] = useState(profile.avatar_url || AVATAR_EMOJI[0]);
  const [avatarColor, setAvatarColor] = useState(profile.avatar_color || AVATAR_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event) {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError('');
    try {
      await updateAccountProfile(profile.id, { name: name.trim(), avatarUrl, avatarColor });
      onSaved();
    } catch (err) {
      setError(err.message || 'Unable to save changes.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="profile-delete-overlay" onClick={onClose}>
      <form className="profile-delete-card" onClick={(event) => event.stopPropagation()} onSubmit={handleSubmit}>
        <h3>Edit Profile</h3>

        <p className="profile-picker-add-label">Picture</p>
        <div className="profile-avatar-picker">
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

        <p className="profile-picker-add-label">Name</p>
        <input
          type="text"
          className="profile-picker-add-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={40}
        />

        {error && <p className="profile-picker-add-error">{error}</p>}
        <div className="profile-picker-add-actions">
          <button type="submit" className="btn-primary btn-sm" disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose} disabled={saving}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
