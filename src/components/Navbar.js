import { useState, useRef, useEffect } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
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
  const isAdmin = user?.isAdmin || user?.userType === 'admin';
  const isDev = user?.isDev || user?.userType === 'dev';

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
          {/* Role buttons */}
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
            <NavLink to="/account-settings" className="navbar-avatar-link" title="Settings" aria-label="Settings">
              <UserAvatar avatarUrl={user.avatarUrl} name={user.username} size="sm" />
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
                <NavLink to="/account-settings" className={navLink} onClick={() => setMobileOpen(false)}>👤 Account</NavLink>
                {isAdmin && <NavLink to="/admin" className={navLink} onClick={() => setMobileOpen(false)}>🛡️ Admin</NavLink>}
                {(isAdmin || isDev) && <NavLink to="/__ops/dev-lab" className={navLink} onClick={() => setMobileOpen(false)}>🔧 Dev</NavLink>}
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
