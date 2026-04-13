import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { hasLegacyBackendSession } from '../utils/legacyBackend';
import UserAvatar from './UserAvatar';

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const canUseLegacyBackend = hasLegacyBackendSession();

  async function handleLogout() {
    await logout();
    navigate('/');
  }

  return (
    <nav className="navbar">
      <Link to={user ? '/home' : '/'} className="navbar-logo">binge.</Link>
      {user ? (
        <>
          <div className="navbar-links">
            <NavLink to="/live-tv" className={({ isActive }) => isActive ? 'active' : ''}>Live TV</NavLink>
            <NavLink to="/movies"    className={({ isActive }) => isActive ? 'active' : ''}>Movies</NavLink>
            <NavLink to="/tv-shows"  className={({ isActive }) => isActive ? 'active' : ''}>TV Shows</NavLink>
            <NavLink to="/books"     className={({ isActive }) => isActive ? 'active' : ''}>Books</NavLink>
            <NavLink to="/ratings"   className={({ isActive }) => isActive ? 'active' : ''}>My Ratings</NavLink>
            <NavLink to="/following" className={({ isActive }) => isActive ? 'active' : ''}>Following</NavLink>
            <NavLink to="/lists" className={({ isActive }) => isActive ? 'active' : ''}>Lists</NavLink>
            <NavLink to="/watchlist" className={({ isActive }) => isActive ? 'active' : ''}>Watchlist</NavLink>
            <NavLink to="/forum"     className={({ isActive }) => isActive ? 'active' : ''}>Forum</NavLink>
          </div>
          <div className="navbar-user">
            <UserAvatar avatarUrl={user.avatarUrl} name={user.username} size="sm" />
            <div className="navbar-user-copy">
              <span className="navbar-username">{user.username}</span>
              {user.bio && <span className="navbar-user-bio">{user.bio}</span>}
            </div>
            <NavLink
              to="/account-settings"
              className={({ isActive }) => `navbar-settings-link${isActive ? ' active' : ''}`}
              aria-label="Account settings"
              title="Account settings"
            >
              <svg
                className="navbar-settings-icon"
                viewBox="0 0 24 24"
                aria-hidden="true"
                focusable="false"
              >
                <path
                  d="M19.14 12.94c.04-.31.06-.62.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.13 7.13 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.58.23-1.13.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.48a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.62-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.4 1.05.71 1.63.94l.36 2.54a.5.5 0 0 0 .49.42h3.8a.5.5 0 0 0 .49-.42l.36-2.54c.58-.23 1.13-.54 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"
                  fill="currentColor"
                />
              </svg>
            </NavLink>
            <button className="btn-ghost" onClick={handleLogout}>Log out</button>
          </div>
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
