import { useEffect, useState } from 'react';
import Navbar from '../components/Navbar';
import { useAuth } from '../contexts/AuthContext';

const MIN_PASSWORD_LENGTH = 6;

export default function AccountSettings() {
  const { user, updateProfile, updatePassword } = useAuth();
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
        </div>
      </main>
    </div>
  );
}
