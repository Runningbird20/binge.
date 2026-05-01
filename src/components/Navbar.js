import { useState, useEffect } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import UserAvatar from './UserAvatar';
import GlobalSearch from './GlobalSearch';
import NotificationBell from './NotificationBell';

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [panelOpen, setPanelOpen] = useState(false);
  const isAdmin = user?.isAdmin || user?.userType === 'admin';
  const isDev   = user?.isDev   || user?.userType === 'dev';

  function close() { setPanelOpen(false); }

  async function handleLogout() {
    await logout();
    navigate('/');
    close();
  }

  // Lock body scroll while panel is open
  useEffect(() => {
    document.body.style.overflow = panelOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [panelOpen]);

  // Escape key closes panel
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') close(); }
    if (panelOpen) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panelOpen]);

  const link = ({ isActive }) => isActive ? 'nav-panel-link active' : 'nav-panel-link';

  return (
    <>
      <nav className="navbar">
        <Link to={user ? '/home' : '/'} className="navbar-logo">binge.</Link>

        {user ? (
          <>
            {(isAdmin || isDev) && (
              <div className="navbar-role-btns">
                {isAdmin && (
                  <NavLink to="/admin" className={({ isActive }) => `navbar-role-btn navbar-role-btn--admin${isActive ? ' active' : ''}`}>
                    Admin
                  </NavLink>
                )}
                {(isAdmin || isDev) && (
                  <NavLink to="/__ops/dev-lab" className={({ isActive }) => `navbar-role-btn navbar-role-btn--dev${isActive ? ' active' : ''}`}>
                    Dev
                  </NavLink>
                )}
              </div>
            )}

            <div className="navbar-search-wrap">
              <GlobalSearch />
            </div>

            <div className="navbar-links navbar-links--desktop">
              <NavLink to="/live-tv"  className={({ isActive }) => isActive ? 'active' : ''}>Live TV</NavLink>
              <NavLink to="/sports"   className={({ isActive }) => isActive ? 'active' : ''}>Sports</NavLink>
              <NavLink to="/movies"   className={({ isActive }) => isActive ? 'active' : ''}>Movies</NavLink>
              <NavLink to="/tv-shows" className={({ isActive }) => isActive ? 'active' : ''}>TV</NavLink>
              <NavLink to="/books"    className={({ isActive }) => isActive ? 'active' : ''}>Books</NavLink>
            </div>

            <div className="navbar-right">
              <NotificationBell />
              <NavLink to={`/profile/${user.username || 'me'}`} className="navbar-avatar-link" title="My Profile" aria-label="My Profile">
                <UserAvatar avatarUrl={user.avatarUrl} name={user.username} size="sm" />
              </NavLink>
              <button
                className={`nav-panel-trigger${panelOpen ? ' is-open' : ''}`}
                onClick={() => setPanelOpen(v => !v)}
                type="button"
                aria-label={panelOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={panelOpen}
              >
                <span className="nav-panel-trigger-bar" />
                <span className="nav-panel-trigger-bar" />
                <span className="nav-panel-trigger-bar" />
              </button>
            </div>
          </>
        ) : (
          <div className="navbar-links">
            <Link to="/login">Log in</Link>
            <Link to="/signup" className="btn-primary">Sign up</Link>
          </div>
        )}
      </nav>

      {/* Dim overlay */}
      <div
        className={`nav-panel-overlay${panelOpen ? ' nav-panel-overlay--visible' : ''}`}
        onClick={close}
        aria-hidden="true"
      />

      {/* Slide-in side panel */}
      <aside className={`nav-panel${panelOpen ? ' nav-panel--open' : ''}`} aria-label="Site navigation">
        <div className="nav-panel-header">
          <Link to={user ? '/home' : '/'} className="nav-panel-brand" onClick={close}>binge.</Link>
          <button className="nav-panel-close" onClick={close} type="button" aria-label="Close menu">
            <span className="nav-panel-close-bar" />
            <span className="nav-panel-close-bar" />
          </button>
        </div>

        <div className="nav-panel-body">
          {user ? (
            <>
              {/* Profile card */}
              <Link to={`/profile/${user.username || 'me'}`} className="nav-panel-user-card" onClick={close}>
                <UserAvatar avatarUrl={user.avatarUrl} name={user.username} size="md" />
                <div className="nav-panel-user-text">
                  <span className="nav-panel-user-name">{user.username}</span>
                  <span className="nav-panel-user-sub">View your profile →</span>
                </div>
              </Link>

              {/* Browse */}
              <div className="nav-panel-section">
                <p className="nav-panel-section-label">Browse</p>
                <nav className="nav-panel-nav">
                  <NavLink to="/home"     className={link} onClick={close}>🏠 Home</NavLink>
                  <NavLink to="/live-tv"  className={link} onClick={close}>📡 Live TV</NavLink>
                  <NavLink to="/sports"   className={link} onClick={close}>🏆 Sports</NavLink>
                  <NavLink to="/movies"   className={link} onClick={close}>🎬 Movies</NavLink>
                  <NavLink to="/tv-shows" className={link} onClick={close}>📺 TV Shows</NavLink>
                  <NavLink to="/books"    className={link} onClick={close}>📖 Books</NavLink>
                  <NavLink to="/lists"    className={link} onClick={close}>📋 Lists</NavLink>
                </nav>
              </div>

              {/* Social */}
              <div className="nav-panel-section">
                <p className="nav-panel-section-label">Social</p>
                <nav className="nav-panel-nav">
                  <NavLink to="/forum"      className={link} onClick={close}>💬 Forum</NavLink>
                  <NavLink to="/watch-room" className={link} onClick={close}>🎬 Watch Together</NavLink>
                  <NavLink to="/following"  className={link} onClick={close}>👥 Following</NavLink>
                  <NavLink to="/trending"   className={link} onClick={close}>🔥 Trending</NavLink>
                </nav>
              </div>

              {/* Account */}
              <div className="nav-panel-section">
                <p className="nav-panel-section-label">Account</p>
                <nav className="nav-panel-nav">
                  <NavLink to="/account-settings"  className={link} onClick={close}>⚙️ Settings</NavLink>
                  {isAdmin && <NavLink to="/admin"          className={link} onClick={close}>🛡️ Admin Panel</NavLink>}
                  {(isAdmin || isDev) && <NavLink to="/__ops/dev-lab" className={link} onClick={close}>🔧 Dev Lab</NavLink>}
                </nav>
              </div>
            </>
          ) : (
            <div className="nav-panel-section">
              <p className="nav-panel-section-label">Get started</p>
              <nav className="nav-panel-nav">
                <Link to="/login"  className="nav-panel-link" onClick={close}>🔑 Log in</Link>
                <Link to="/signup" className="nav-panel-link" onClick={close}>✨ Sign up</Link>
              </nav>
            </div>
          )}
        </div>

        {user && (
          <div className="nav-panel-footer">
            <button className="nav-panel-logout" onClick={handleLogout} type="button">
              Log Out
            </button>
          </div>
        )}
      </aside>

    </>
  );
}
