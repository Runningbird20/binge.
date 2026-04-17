import { useState, useRef, useEffect } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getDefaultRouteForUserType } from '../utils/userAccess';
import UserAvatar from './UserAvatar';
import GlobalSearch from './GlobalSearch';
import NotificationBell from './NotificationBell';

function SocialDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div className="nav-dropdown-wrap" ref={ref}>
      <button
        className={`nav-dropdown-trigger ${open ? 'active' : ''}`}
        onClick={() => setOpen(v => !v)}
        type="button"
      >
        Social <span className="nav-dropdown-caret">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="nav-dropdown-menu" onClick={() => setOpen(false)}>
          <NavLink to="/forum"      className="nav-dropdown-item">💬 Forum</NavLink>
          <NavLink to="/watch-room" className="nav-dropdown-item">🎬 Watch Together</NavLink>
          <NavLink to="/following"  className="nav-dropdown-item">👥 Following</NavLink>
          <NavLink to="/trending"   className="nav-dropdown-item">🔥 Trending</NavLink>
        </div>
      )}
    </div>
  );
}

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const dashboardRoute = getDefaultRouteForUserType(user);

  async function handleLogout() {
    await logout();
    navigate('/');
    setMobileOpen(false);
  }

  const navLink = ({ isActive }) => isActive ? 'active' : '';

  return (
    <nav className="navbar">
      <Link to={user ? '/home' : '/'} className="navbar-logo">binge.</Link>

      {user ? (
        <>
          {/* Search */}
          <div className="navbar-search-wrap">
            <GlobalSearch />
          </div>

          {/* Desktop links */}
          <div className="navbar-links navbar-links--desktop">
            <NavLink to="/live-tv"  className={navLink}>Live TV</NavLink>
            <NavLink to="/movies"   className={navLink}>Movies</NavLink>
            <NavLink to="/tv-shows" className={navLink}>TV</NavLink>
            <NavLink to="/books"    className={navLink}>Books</NavLink>
            <SocialDropdown />
          </div>

          {/* Right side */}
          <div className="navbar-right">
            <NotificationBell />
            <NavLink to={dashboardRoute} className="navbar-avatar-link" title="Dashboard">
              <UserAvatar avatarUrl={user.avatarUrl} name={user.username} size="sm" />
            </NavLink>
            <NavLink
              to="/account-settings"
              className={({ isActive }) => `navbar-settings-link${isActive ? ' active' : ''}`}
              aria-label="Settings"
              title="Settings"
            >
              <svg className="navbar-settings-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M19.14 12.94c.04-.31.06-.62.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.13 7.13 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.58.23-1.13.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.48a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.62-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.4 1.05.71 1.63.94l.36 2.54a.5.5 0 0 0 .49.42h3.8a.5.5 0 0 0 .49-.42l.36-2.54c.58-.23 1.13-.54 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z" fill="currentColor" />
              </svg>
            </NavLink>
            <button className="btn-ghost navbar-logout" onClick={handleLogout}>Log out</button>
            <button className="navbar-hamburger" onClick={() => setMobileOpen(v => !v)} type="button" aria-label="Menu">
              {mobileOpen ? '✕' : '☰'}
            </button>
          </div>

          {/* Mobile menu */}
          {mobileOpen && (
            <div className="navbar-mobile-menu" onClick={() => setMobileOpen(false)}>
              <div className="navbar-mobile-inner" onClick={e => e.stopPropagation()}>
                <div className="navbar-mobile-search"><GlobalSearch /></div>
                <NavLink to="/home"       className={navLink} onClick={() => setMobileOpen(false)}>🏠 Home</NavLink>
                <NavLink to="/live-tv"    className={navLink} onClick={() => setMobileOpen(false)}>📡 Live TV</NavLink>
                <NavLink to="/movies"     className={navLink} onClick={() => setMobileOpen(false)}>🎬 Movies</NavLink>
                <NavLink to="/tv-shows"   className={navLink} onClick={() => setMobileOpen(false)}>📺 TV Shows</NavLink>
                <NavLink to="/books"      className={navLink} onClick={() => setMobileOpen(false)}>📖 Books</NavLink>
                <NavLink to="/forum"      className={navLink} onClick={() => setMobileOpen(false)}>💬 Forum</NavLink>
                <NavLink to="/watch-room" className={navLink} onClick={() => setMobileOpen(false)}>🎬 Watch Together</NavLink>
                <NavLink to="/following"  className={navLink} onClick={() => setMobileOpen(false)}>👥 Following</NavLink>
                <NavLink to={`/profile/${user.username}`} className={navLink} onClick={() => setMobileOpen(false)}>👤 My Profile</NavLink>
                <NavLink to="/account-settings" className={navLink} onClick={() => setMobileOpen(false)}>⚙️ Settings</NavLink>
                <button className="btn-ghost" onClick={handleLogout} type="button">Log out</button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="navbar-links">
          <Link to="/login">Log in</Link>
          <Link to="/signup" className="btn-primary">Sign up</Link>
        </div>
      )}
    </nav>
  );
}
