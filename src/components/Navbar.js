import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/');
  }

  return (
    <nav className="navbar">
      <Link to={user ? '/home' : '/'} className="navbar-logo">[TBD]</Link>
      {user ? (
        <>
          <div className="navbar-links">
            <NavLink to="/movies"    className={({ isActive }) => isActive ? 'active' : ''}>Movies</NavLink>
            <NavLink to="/tv-shows"  className={({ isActive }) => isActive ? 'active' : ''}>TV Shows</NavLink>
            <NavLink to="/books"     className={({ isActive }) => isActive ? 'active' : ''}>Books</NavLink>
            <NavLink to="/watchlist" className={({ isActive }) => isActive ? 'active' : ''}>Watchlist</NavLink>
          </div>
          <div className="navbar-user">
            <span className="navbar-username">{user.username}</span>
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
