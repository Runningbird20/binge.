import { useState, useEffect } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import {
  House,
  Broadcast,
  PlusSquare,
  FilmSlate,
  MonitorPlay,
  BookOpen,
} from '@phosphor-icons/react';
import { useAuth } from '../contexts/AuthContext';
import UserAvatar from './UserAvatar';
import GlobalSearch from './GlobalSearch';
import NotificationBell from './NotificationBell';

const NAV_LINKS = [
  { to: '/home',      label: 'Home',      Icon: House },
  { to: '/live-tv',   label: 'Live',      Icon: Broadcast },
  { to: '/watchlist', label: 'Watchlist', Icon: PlusSquare },
  { to: '/movies',    label: 'Movies',    Icon: FilmSlate },
  { to: '/tv-shows',  label: 'Series',    Icon: MonitorPlay },
  { to: '/books',     label: 'Books',     Icon: BookOpen },
];

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [panelOpen, setPanelOpen] = useState(false);
  const isAdmin = user?.isAdmin || user?.userType === 'admin';

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
      <nav className={`navbar${user ? ' navbar--stream' : ''}`}>
        <Link to={user ? '/home' : '/'} className="navbar-logo">binge.</Link>

        {user ? (
          <>
            <NavLink
              to={`/profile/${user.username || 'me'}`}
              className="navbar-profile"
              title="My Profile"
            >
              <UserAvatar avatarUrl={user.avatarUrl} name={user.username} size="sm" />
              <span className="navbar-profile-name">{user.username}</span>
            </NavLink>

            {isAdmin && (
              <div className="navbar-role-btns">
                <NavLink to="/admin" className={({ isActive }) => `navbar-role-btn navbar-role-btn--admin${isActive ? ' active' : ''}`}>
                  Admin
                </NavLink>
              </div>
            )}

            <div className="navbar-center navbar-links--desktop">
              {NAV_LINKS.map(({ to, label, Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) => `navbar-icon-link${isActive ? ' active' : ''}`}
                >
                  <Icon size={20} weight="bold" aria-hidden="true" />
                  <span>{label}</span>
                </NavLink>
              ))}
            </div>

            <div className="navbar-right">
              <div className="navbar-search-wrap">
                <GlobalSearch />
              </div>
              <NotificationBell />
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
                  <NavLink to="/watch-room" className={link} onClick={close}>🎬 Watch Together</NavLink>
                  <NavLink to="/following"  className={link} onClick={close}>👥 Following</NavLink>
                </nav>
              </div>

              {/* Account */}
              <div className="nav-panel-section">
                <p className="nav-panel-section-label">Account</p>
                <nav className="nav-panel-nav">
                  <NavLink to="/account-settings"  className={link} onClick={close}>⚙️ Settings</NavLink>
                  {isAdmin && <NavLink to="/admin"          className={link} onClick={close}>🛡️ Admin Panel</NavLink>}
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
