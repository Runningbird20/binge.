import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getDefaultRouteForUserType } from '../utils/userAccess';

export default function Landing() {
  const { isAuthenticated, authLoading, user } = useAuth();

  if (!authLoading && isAuthenticated) {
    return <Navigate to={getDefaultRouteForUserType(user)} replace />;
  }

  return (
    <div className="App">
      <section
        className="landing-hero"
        style={{ backgroundImage: `url(${process.env.PUBLIC_URL}/landing-hero.webp)` }}
      >
        <div className="landing-hero-overlay" aria-hidden="true" />
        <div className="landing-hero-content">
          <div className="landing-logo">binge.</div>
          <h1 className="landing-hero-title">Everything you watch and read, in one place.</h1>
          <p className="landing-hero-subtitle">
            Track movies, TV shows, and books, rate what you finish, and get picks tailored to your taste.
          </p>
          <div className="landing-hero-actions">
            <Link to="/signup" className="btn-primary btn-large">Create Account</Link>
            <Link to="/login" className="btn-secondary btn-large">Sign In</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
