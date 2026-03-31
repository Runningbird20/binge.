import { useState } from 'react';
import './App.css';

function App() {
  const [activeView, setActiveView] = useState('signup');
  const [formData, setFormData] = useState({
    username: '',
    bio: '',
    password: '',
  });
  const [uploadedAvatar, setUploadedAvatar] = useState(null);
  const [profile, setProfile] = useState(null);

  const displayName = profile?.username || formData.username.trim() || 'your_name';
  const displayBio =
    profile?.bio ||
    formData.bio.trim() ||
    'Your username, bio, and avatar preview will appear here.';
  const currentAvatarImage = profile?.avatarImage || uploadedAvatar?.previewUrl || '';
  const fallbackInitial = displayName.charAt(0).toUpperCase() || 'Y';

  const handleChange = (event) => {
    const { name, value } = event.target;

    setFormData((current) => ({
      ...current,
      [name]: value,
    }));
  };

  const handleAvatarUpload = (event) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const reader = new FileReader();

    setUploadedAvatar({
      fileName: file.name,
      previewUrl: '',
    });

    reader.onload = () => {
      setUploadedAvatar({
        fileName: file.name,
        previewUrl: typeof reader.result === 'string' ? reader.result : '',
      });
    };

    reader.readAsDataURL(file);
  };

  const handleSubmit = (event) => {
    event.preventDefault();

    const username = formData.username.trim();
    const bio = formData.bio.trim();
    const password = formData.password;

    if (!username || !bio || !password.trim()) {
      return;
    }

    setProfile({
      username,
      bio,
      avatarImage: uploadedAvatar?.previewUrl || '',
    });
  };

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span>Media Journal</span>
        </div>

        <nav className="auth-nav" aria-label="Authentication options">
          <button
            type="button"
            className={`nav-button${activeView === 'login' ? ' is-active' : ''}`}
            onClick={() => setActiveView('login')}
            aria-pressed={activeView === 'login'}
          >
            Log in
          </button>
          <button
            type="button"
            className={`nav-button${activeView === 'signup' ? ' is-active' : ''}`}
            onClick={() => setActiveView('signup')}
            aria-pressed={activeView === 'signup'}
          >
            Sign up
          </button>
        </nav>
      </header>

      <main className="app">
        <section className="card">
          {activeView === 'signup' ? (
            <>
              <div className="card-header">
                <p className="eyebrow">Create an Acc</p>
                <h1>Create your profile</h1>
                <p className="subcopy">
                  Start with a username, short bio, and photo avatar. Media
                  history and community tools are placeholders for now.
                </p>
              </div>

              <form className="form" onSubmit={handleSubmit}>
                <label className="field">
                  <span>Username</span>
                  <input
                    name="username"
                    type="text"
                    placeholder="moviefan"
                    value={formData.username}
                    onChange={handleChange}
                    maxLength="24"
                    required
                  />
                </label>

                <label className="field">
                  <span>Bio</span>
                  <textarea
                    name="bio"
                    placeholder="Share a short note about what you like."
                    value={formData.bio}
                    onChange={handleChange}
                    rows="4"
                    maxLength="160"
                    required
                  />
                </label>

                <label className="field">
                  <span>Password</span>
                  <input
                    name="password"
                    type="password"
                    placeholder="Create a password"
                    value={formData.password}
                    onChange={handleChange}
                    minLength="8"
                    required
                  />
                </label>

                <label className="field">
                  <span>Upload avatar photo</span>
                  <input
                    id="avatar-upload"
                    name="avatarUpload"
                    type="file"
                    accept="image/*"
                    onChange={handleAvatarUpload}
                  />
                  <p className="field-note">
                    {uploadedAvatar
                      ? `${uploadedAvatar.fileName} selected for your avatar.`
                      : 'Upload a photo to use as your avatar.'}
                  </p>
                </label>

                <button className="primary-button" type="submit">
                  {profile ? 'Update profile' : 'Create profile'}
                </button>
              </form>

              <section className="summary" aria-label="Profile summary">
                {currentAvatarImage ? (
                  <img
                    className="summary-avatar summary-avatar--image"
                    src={currentAvatarImage}
                    alt="Avatar preview"
                  />
                ) : (
                  <div className="summary-avatar summary-avatar--fallback" aria-hidden="true">
                    {fallbackInitial}
                  </div>
                )}

                <div>
                  <h2>@{displayName}</h2>
                  <p>{displayBio}</p>
                  {profile ? (
                    <p className="status" role="status">
                      Profile created locally.
                    </p>
                  ) : null}
                </div>
              </section>
            </>
          ) : (
            <section className="placeholder-panel">
              <div className="card-header">
                <p className="eyebrow">Login</p>
                <h1>Log in will live here</h1>
                <p className="subcopy">
                  Login is not built yet. Use the Sign up tab to create a basic
                  local profile for now.
                </p>
              </div>

              <div className="placeholder-box">
                <p>Email and password fields coming soon.</p>
                <p>Saved media history and community access coming soon.</p>
              </div>
            </section>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
