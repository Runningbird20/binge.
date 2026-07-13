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
  const isAdmin = user?.isAdmin || user?.userType === 'admin';
  const profileLink = `/profile/${user?.username || 'me'}`;

  async function handleLogout() {
    await logout();
    navigate('/');
  }

  const profileDrawerLink = ({ isActive }) => isActive ? 'profile-hover-link active' : 'profile-hover-link';

  return (
    <>
      <nav className={`navbar${user ? ' navbar--stream' : ''}`}>
        <Link to={user ? '/home' : '/'} className="navbar-logo">binge.</Link>

        {user ? (
          <>
            <div className="navbar-profile-wrap">
              <NavLink
                to={profileLink}
                className="navbar-profile"
                title="My Profile"
              >
                <UserAvatar avatarUrl={user.avatarUrl} name={user.username} size="sm" />
                <span className="navbar-profile-name">{user.username}</span>
              </NavLink>

              <div className="profile-hover-drawer">
                <div className="profile-hover-card">
                  <Link to={profileLink} className="profile-hover-user-link">
                    <UserAvatar avatarUrl={user.avatarUrl} name={user.username} size="md" />
                    <div className="profile-hover-user-text">
                      <span className="profile-hover-user-name">{user.username}</span>
                      <span className="profile-hover-user-sub">View your profile →</span>
                    </div>
                  </Link>

                  <div className="profile-hover-section">
                    <p className="profile-hover-section-label">Account</p>
                    <nav className="profile-hover-nav">
                      <NavLink to="/account-settings" className={profileDrawerLink}>⚙️ Account Settings</NavLink>
                      {isAdmin && <NavLink to="/admin" className={profileDrawerLink}>🛡️ Admin Panel</NavLink>}
                    </nav>
                  </div>

                  <button className="profile-hover-logout" onClick={handleLogout} type="button">
                    Log Out
                  </button>
                </div>
              </div>
            </div>

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
            </div>
          </>
        ) : (
          <div className="navbar-links">
            <Link to="/login">Log in</Link>
            <Link to="/signup" className="btn-primary">Sign up</Link>
          </div>
        )}
      </nav>

    </>
  );
}
