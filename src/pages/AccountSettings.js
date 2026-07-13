import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import UserAvatar from '../components/UserAvatar';
import AvatarPresetPicker from '../components/AvatarPresetPicker';
import { useAuth } from '../contexts/AuthContext';
import { uploadSupabaseAvatar } from '../utils/supabaseData';

const MIN_PASSWORD_LENGTH = 6;

export default function AccountSettings() {
  const { user, updateProfile, updatePassword, logout } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [profileForm, setProfileForm] = useState({
    username: user?.username || '',
    email: user?.email || '',
  });
  const [passwordForm, setPasswordForm] = useState({
    newPassword: '',
    confirmPassword: '',
  });
  const [profileError, setProfileError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [profileLoading, setProfileLoading] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);

  // Avatar state
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const [avatarSuccess, setAvatarSuccess] = useState('');

  useEffect(() => {
    setProfileForm({
      username: user?.username || '',
      email: user?.email || '',
    });
  }, [user?.username, user?.email]);

  function updateProfileForm(key, value) {
    setProfileForm((current) => ({ ...current, [key]: value }));
  }

  function updatePasswordForm(key, value) {
    setPasswordForm((current) => ({ ...current, [key]: value }));
  }

  async function handleProfileSubmit(e) {
    e.preventDefault();
    setProfileError('');
    setProfileSuccess('');

    const username = profileForm.username.trim();
    const email = profileForm.email.trim().toLowerCase();

    if (!username || !email) {
      setProfileError('Username and email are required');
      return;
    }

    if (username === user?.username && email === user?.email) {
      setProfileSuccess('Your account details are already up to date.');
      return;
    }

    setProfileLoading(true);
    try {
      await updateProfile({
        username,
        email,
        bio: user?.bio || '',
        avatarUrl: user?.avatarUrl || null,
      });
      setProfileSuccess('Account details updated.');
    } catch (err) {
      setProfileError(err.message);
    } finally {
      setProfileLoading(false);
    }
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarError('');
    setAvatarSuccess('');
    if (!file.type.startsWith('image/')) {
      setAvatarError('Please choose an image file (JPEG, PNG, WebP, etc.).');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setAvatarError('Image must be under 5 MB.');
      return;
    }
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  }

  function handleCancelAvatar() {
    setAvatarFile(null);
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatarPreview(null);
    setAvatarError('');
    setAvatarSuccess('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleAvatarUpload() {
    if (!avatarFile) return;
    setAvatarLoading(true);
    setAvatarError('');
    setAvatarSuccess('');
    try {
      const publicUrl = await uploadSupabaseAvatar(avatarFile);
      await updateProfile({
        username: user?.username || '',
        email: user?.email || '',
        bio: user?.bio || '',
        avatarUrl: publicUrl,
      });
      setAvatarSuccess('Profile picture updated.');
      setAvatarFile(null);
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
      setAvatarPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      setAvatarError(err.message);
    } finally {
      setAvatarLoading(false);
    }
  }

  async function handleSelectPreset(url) {
    setAvatarLoading(true);
    setAvatarError('');
    setAvatarSuccess('');
    try {
      await updateProfile({
        username: user?.username || '',
        email: user?.email || '',
        bio: user?.bio || '',
        avatarUrl: url,
      });
      setAvatarSuccess('Profile picture updated.');
      handleCancelAvatar();
    } catch (err) {
      setAvatarError(err.message);
    } finally {
      setAvatarLoading(false);
    }
  }

  async function handleRemoveAvatar() {
    setAvatarLoading(true);
    setAvatarError('');
    setAvatarSuccess('');
    try {
      await updateProfile({
        username: user?.username || '',
        email: user?.email || '',
        bio: user?.bio || '',
        avatarUrl: null,
      });
      setAvatarSuccess('Profile picture removed.');
    } catch (err) {
      setAvatarError(err.message);
    } finally {
      setAvatarLoading(false);
    }
  }

  async function handleLogout() {
    await logout();
    navigate('/');
  }

  async function handlePasswordSubmit(e) {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    if (!passwordForm.newPassword || !passwordForm.confirmPassword) {
      setPasswordError('Fill in your new password in both fields');
      return;
    }

    if (passwordForm.newPassword.length < MIN_PASSWORD_LENGTH) {
      setPasswordError(`New password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }

    setPasswordLoading(true);
    try {
      await updatePassword(passwordForm.newPassword);
      setPasswordForm({
        newPassword: '',
        confirmPassword: '',
      });
      setPasswordSuccess('Password updated.');
    } catch (err) {
      setPasswordError(err.message);
    } finally {
      setPasswordLoading(false);
    }
  }

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content">
        <div className="page-header settings-page-header">
          <div>
            <p className="settings-eyebrow">Account</p>
            <h1>Settings</h1>
            <p className="settings-subtitle">Update your username, email, and password.</p>
          </div>
        </div>

        <div className="settings-grid">
          {/* ── Profile picture ── */}
          <section className="settings-card settings-card--avatar">
            <div className="settings-card-header">
              <h2>Profile picture</h2>
              <p>Upload a photo or pick a preset to personalize your profile.</p>
            </div>

            {avatarError && <div className="auth-error">{avatarError}</div>}
            {avatarSuccess && <div className="settings-success">{avatarSuccess}</div>}

            <div className="avatar-upload-row">
              <div className="avatar-upload-preview">
                <UserAvatar
                  avatarUrl={avatarPreview || user?.avatarUrl}
                  name={user?.username}
                  size="xl"
                />
                {avatarPreview && <span className="avatar-preview-badge">Preview</span>}
              </div>

              <div className="avatar-upload-controls">
                <label className="avatar-file-label">
                  {avatarPreview ? 'Choose different image' : 'Choose image'}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    onChange={handleFileChange}
                    className="avatar-file-input"
                  />
                </label>

                {avatarPreview && (
                  <>
                    <button
                      type="button"
                      className="btn-primary btn-sm"
                      onClick={handleAvatarUpload}
                      disabled={avatarLoading}
                    >
                      {avatarLoading ? 'Uploading...' : 'Save photo'}
                    </button>
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      onClick={handleCancelAvatar}
                      disabled={avatarLoading}
                    >
                      Cancel
                    </button>
                  </>
                )}

                {!avatarPreview && user?.avatarUrl && (
                  <button
                    type="button"
                    className="btn-ghost btn-sm avatar-remove-btn"
                    onClick={handleRemoveAvatar}
                    disabled={avatarLoading}
                  >
                    {avatarLoading ? 'Removing...' : 'Remove photo'}
                  </button>
                )}

                <p className="avatar-upload-hint">JPEG, PNG, or WebP · max 5 MB</p>
              </div>
            </div>

            <div className="avatar-preset-section">
              <p className="avatar-preset-label">Or pick a preset</p>
              <AvatarPresetPicker
                selected={user?.avatarUrl}
                onSelect={handleSelectPreset}
                disabled={avatarLoading}
              />
            </div>
          </section>

          {/* ── Profile details ── */}
          <section className="settings-card">
            <div className="settings-card-header">
              <h2>Profile details</h2>
              <p>These details appear anywhere your account is shown.</p>
            </div>

            {profileError && <div className="auth-error">{profileError}</div>}
            {profileSuccess && <div className="settings-success">{profileSuccess}</div>}

            <form className="auth-form settings-form" onSubmit={handleProfileSubmit}>
              <label>
                Username
                <input
                  type="text"
                  value={profileForm.username}
                  onChange={(e) => updateProfileForm('username', e.target.value)}
                  placeholder="johndoe"
                  required
                />
              </label>

              <label>
                Email
                <input
                  type="email"
                  value={profileForm.email}
                  onChange={(e) => updateProfileForm('email', e.target.value)}
                  placeholder="you@example.com"
                  required
                />
              </label>

              <button type="submit" className="btn-primary" disabled={profileLoading}>
                {profileLoading ? 'Saving...' : 'Save changes'}
              </button>
            </form>
          </section>

          <section className="settings-card">
            <div className="settings-card-header">
              <h2>Password</h2>
              <p>Set a new password for your Supabase account.</p>
            </div>

            {passwordError && <div className="auth-error">{passwordError}</div>}
            {passwordSuccess && <div className="settings-success">{passwordSuccess}</div>}

            <form className="auth-form settings-form" onSubmit={handlePasswordSubmit}>
              <label>
                New password
                <input
                  type="password"
                  value={passwordForm.newPassword}
                  onChange={(e) => updatePasswordForm('newPassword', e.target.value)}
                  placeholder="At least 6 characters"
                  autoComplete="new-password"
                  required
                />
              </label>

              <label>
                Confirm new password
                <input
                  type="password"
                  value={passwordForm.confirmPassword}
                  onChange={(e) => updatePasswordForm('confirmPassword', e.target.value)}
                  placeholder="Re-enter new password"
                  autoComplete="new-password"
                  required
                />
              </label>

              <button type="submit" className="btn-primary" disabled={passwordLoading}>
                {passwordLoading ? 'Updating...' : 'Update password'}
              </button>
            </form>
          </section>
          <section className="settings-card">
            <div className="settings-card-header">
              <h2>Sign out</h2>
              <p>You will be returned to the landing page.</p>
            </div>
            <button type="button" className="btn-danger" onClick={handleLogout}>
              Log out
            </button>
          </section>
        </div>
      </main>
    </div>
  );
}
