import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api';
import UserAvatar from '../components/UserAvatar';

const MAX_BIO_LENGTH = 280;
const MAX_AVATAR_SIZE_BYTES = 2 * 1024 * 1024;

export default function Signup() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    username: '',
    email: '',
    password: '',
    bio: '',
    avatarUrl: '',
  });
  const [avatarFileName, setAvatarFileName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function updateForm(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function handleAvatarChange(e) {
    const file = e.target.files?.[0];
    if (!file) {
      setAvatarFileName('');
      updateForm('avatarUrl', '');
      return;
    }

    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file for your avatar');
      e.target.value = '';
      return;
    }

    if (file.size > MAX_AVATAR_SIZE_BYTES) {
      setError('Avatar image must be smaller than 2 MB');
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      setError('');
      setAvatarFileName(file.name);
      updateForm('avatarUrl', event.target?.result || '');
    };
    reader.onerror = () => {
      setError('We could not read that image. Please try another file.');
      e.target.value = '';
    };
    reader.readAsDataURL(file);
  }

  function clearAvatar() {
    setAvatarFileName('');
    updateForm('avatarUrl', '');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (form.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    if (form.bio.trim().length > MAX_BIO_LENGTH) {
      setError(`Bio must be ${MAX_BIO_LENGTH} characters or fewer`);
      return;
    }

    setLoading(true);
    try {
      const payload = {
        ...form,
        username: form.username.trim(),
        email: form.email.trim(),
        bio: form.bio.trim(),
      };
      const { token, user } = await api.post('/auth/signup', payload);
      login(user, token);
      navigate('/home');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card auth-card-wide">
        <Link to="/" className="auth-logo">[TBD]</Link>
        <h1>Create your account</h1>
        <p className="auth-subtitle">
          Add a username, bio, and avatar so your profile is ready for logging and community activity.
        </p>

        {error && <div className="auth-error">{error}</div>}

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="avatar-field">
            <div className="avatar-field-header">
              <div>
                <span className="auth-label-title">Avatar</span>
                <p className="auth-field-hint">Upload a profile photo to personalize your account.</p>
              </div>
              <UserAvatar
                avatarUrl={form.avatarUrl}
                name={form.username || 'New user'}
                size="xl"
                alt="Avatar preview"
              />
            </div>
            <label className="avatar-upload-label">
              Upload avatar photo
              <input
                type="file"
                accept="image/*"
                onChange={handleAvatarChange}
              />
            </label>
            {avatarFileName && (
              <div className="avatar-upload-meta">
                <span>{avatarFileName} selected for your avatar.</span>
                <button type="button" className="btn-ghost" onClick={clearAvatar}>
                  Remove
                </button>
              </div>
            )}
          </div>

          <label>
            Username
            <input
              type="text"
              value={form.username}
              onChange={(e) => updateForm('username', e.target.value)}
              placeholder="johndoe"
              required
              autoFocus
            />
          </label>

          <label>
            Email
            <input
              type="email"
              value={form.email}
              onChange={(e) => updateForm('email', e.target.value)}
              placeholder="you@example.com"
              required
            />
          </label>

          <label>
            Bio
            <textarea
              value={form.bio}
              onChange={(e) => updateForm('bio', e.target.value)}
              placeholder="Tell people what you love to watch, read, and recommend."
              rows={4}
              maxLength={MAX_BIO_LENGTH}
            />
            <span className="auth-field-count">{form.bio.length}/{MAX_BIO_LENGTH}</span>
          </label>

          <label>
            Password
            <input
              type="password"
              value={form.password}
              onChange={(e) => updateForm('password', e.target.value)}
              placeholder="At least 6 characters"
              required
            />
          </label>

          <button type="submit" className="btn-primary btn-block" disabled={loading}>
            {loading ? 'Creating account...' : 'Create account'}
          </button>
        </form>

        <p className="auth-switch">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </div>
    </div>
  );
}
