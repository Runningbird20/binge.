import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import UserAvatar from '../components/UserAvatar';
import AvatarPresetPicker from '../components/AvatarPresetPicker';
import LoadingBar from '../components/LoadingBar';
import { getDefaultRouteForUserType } from '../utils/userAccess';
import { fetchInvite, requestAccount } from '../utils/accountRequests';

const MAX_BIO_LENGTH = 280;
const MAX_AVATAR_SIZE_BYTES = 2 * 1024 * 1024;

const BACKGROUND = { backgroundImage: `url(${process.env.PUBLIC_URL}/landing-hero.webp)` };

// /signup. Accounts are invite-only (docs/invite-only.md): without an invite
// this is the request form; the approval email links back here with
// ?invite=…, which opens the regular sign-up form for that address.
export default function Signup() {
  const [params] = useSearchParams();
  const invite = params.get('invite');
  return invite ? <InviteSignup token={invite} /> : <RequestAccount />;
}

function RequestAccount() {
  const [form, setForm] = useState({ name: '', email: '', note: '' });
  const [sentTo, setSentTo] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const email = form.email.trim();
      await requestAccount({ name: form.name.trim(), email, note: form.note.trim() });
      setSentTo(email);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page" style={BACKGROUND}>
      <div className="auth-card">
        <Link to="/" className="auth-logo">binge.</Link>
        <h1>Request an account</h1>
        <p className="auth-subtitle">
          binge. is invite-only. Tell us who you are, and we’ll email you a link to create your account once it’s approved.
        </p>

        {sentTo ? (
          <div className="settings-success" role="status">
            Request sent. We’ll email <strong>{sentTo}</strong> when it’s approved.
          </div>
        ) : (
          <form className="auth-form" onSubmit={handleSubmit}>
            {error && <div className="auth-error" role="alert">{error}</div>}
            <label>
              <input aria-label="Your name" placeholder="Your name" type="text" value={form.name} onChange={update('name')} maxLength={80} required autoFocus />
            </label>
            <label>
              <input aria-label="Email" placeholder="Email" type="email" value={form.email} onChange={update('email')} required />
            </label>
            <label>
              <textarea aria-label="Anything we should know? (optional)" placeholder="Anything we should know? (optional)" value={form.note} onChange={update('note')} rows={3} maxLength={500} />
            </label>
            <button type="submit" className="btn-primary btn-block" disabled={loading}>
              {loading ? 'Sending request…' : 'Request account'}
            </button>
          </form>
        )}

        <p className="auth-switch">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </div>
    </div>
  );
}

function InviteSignup({ token }) {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const avatarInputRef = useRef(null);
  // { email, name } once the invite checks out; { error } when it doesn't.
  const [invite, setInvite] = useState(null);
  const [form, setForm] = useState({
    username: '',
    password: '',
    bio: '',
    avatarUrl: '',
  });

  useEffect(() => {
    let cancelled = false;
    setInvite(null);
    fetchInvite(token)
      .then((info) => { if (!cancelled) setInvite(info); })
      .catch((err) => { if (!cancelled) setInvite({ error: err.message }); });
    return () => { cancelled = true; };
  }, [token]);
  const [avatarFileName, setAvatarFileName] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
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
      setAvatarFileName('');
      updateForm('avatarUrl', '');
      e.target.value = '';
      return;
    }

    if (file.size > MAX_AVATAR_SIZE_BYTES) {
      setError('Avatar image must be smaller than 2 MB');
      setAvatarFileName('');
      updateForm('avatarUrl', '');
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
      setAvatarFileName('');
      updateForm('avatarUrl', '');
      e.target.value = '';
    };
    reader.readAsDataURL(file);
  }

  function clearAvatar() {
    setAvatarFileName('');
    updateForm('avatarUrl', '');
    if (avatarInputRef.current) {
      avatarInputRef.current.value = '';
    }
  }

  function selectPresetAvatar(url) {
    setError('');
    setAvatarFileName('');
    updateForm('avatarUrl', url);
    if (avatarInputRef.current) {
      avatarInputRef.current.value = '';
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');

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
        inviteToken: token,
        username: form.username.trim(),
        email: invite.email,
        bio: form.bio.trim(),
      };
      const result = await signUp(payload);
      if (result.requiresEmailConfirmation) {
        setSuccess('Check your email to confirm your account, then come back here to log in.');
        return;
      }
      navigate(getDefaultRouteForUserType(result.user));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (!invite || invite.error) {
    return (
      <div className="auth-page" style={BACKGROUND}>
        <div className="auth-card">
          <Link to="/" className="auth-logo">binge.</Link>
          <h1>Create your account</h1>
          {!invite ? (
            <LoadingBar label="Checking your invite…" />
          ) : (
            <>
              <div className="auth-error" role="alert">{invite.error}</div>
              <p className="auth-switch">
                <Link to="/signup">Request an account</Link> or <Link to="/login">log in</Link>.
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page" style={BACKGROUND}>
      <div className="auth-card auth-card-wide">
        <Link to="/" className="auth-logo">binge.</Link>
        <h1>Create your account</h1>
        <p className="auth-subtitle">
          You’re approved{invite.name ? `, ${invite.name.split(' ')[0]}` : ''}. Add a username, bio, and avatar so your profile is ready for logging and community activity.
        </p>

        {error && <div className="auth-error">{error}</div>}
        {success && <div className="settings-success">{success}</div>}

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="avatar-field">
            <span className="auth-label-title">Avatar</span>
            <div className="avatar-field-frame">
              <div className="avatar-field-header">
                <div className="avatar-field-copy">
                  <p className="auth-field-hint">Upload a photo or pick a preset to personalize your account.</p>
                  <span className="avatar-upload-note">PNG, JPG, GIF, or WebP up to 2 MB</span>
                </div>
                <UserAvatar
                  avatarUrl={form.avatarUrl}
                  name={form.username || 'New user'}
                  size="xl"
                  alt="Avatar preview"
                />
              </div>
              <div className="avatar-field-actions">
                <label htmlFor="avatar-upload" className="avatar-upload-trigger">
                  {avatarFileName ? 'Change avatar photo' : 'Upload avatar photo'}
                </label>
                <input
                  id="avatar-upload"
                  ref={avatarInputRef}
                  className="avatar-upload-input"
                  type="file"
                  accept="image/*"
                  aria-label="Upload avatar photo"
                  onChange={handleAvatarChange}
                />
                <span className="avatar-upload-status">
                  {avatarFileName ? `${avatarFileName} selected for your avatar` : 'Optional'}
                </span>
              </div>
              {avatarFileName && (
                <div className="avatar-upload-meta">
                  <span className="avatar-upload-chip" title={avatarFileName}>{avatarFileName}</span>
                  <button type="button" className="btn-ghost btn-sm" onClick={clearAvatar}>
                    Remove
                  </button>
                </div>
              )}
              {!avatarFileName && form.avatarUrl && (
                <div className="avatar-upload-meta">
                  <span className="avatar-upload-chip">Preset avatar selected</span>
                  <button type="button" className="btn-ghost btn-sm" onClick={clearAvatar}>
                    Remove
                  </button>
                </div>
              )}
              <div className="avatar-preset-section">
                <p className="avatar-preset-label">Or pick a preset</p>
                <AvatarPresetPicker selected={form.avatarUrl} onSelect={selectPresetAvatar} />
              </div>
            </div>
          </div>

          <label>
            <input
              aria-label="Username"
              placeholder="Username"
              type="text"
              value={form.username}
              onChange={(e) => updateForm('username', e.target.value)}
              required
              autoFocus
            />
          </label>

          <label>
            <input
              aria-label="Email"
              placeholder="Email"
              type="email"
              value={invite.email}
              readOnly
              title="Your account is for the address the invite was sent to"
            />
          </label>

          <label>
            <textarea
              aria-label="Bio"
              placeholder="Bio"
              value={form.bio}
              onChange={(e) => updateForm('bio', e.target.value)}
              rows={4}
              maxLength={MAX_BIO_LENGTH}
            />
            <span className="auth-field-count">{form.bio.length}/{MAX_BIO_LENGTH}</span>
          </label>

          <label>
            <input
              aria-label="Password (at least 6 characters)"
              placeholder="Password (at least 6 characters)"
              type="password"
              value={form.password}
              onChange={(e) => updateForm('password', e.target.value)}
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
