import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Navigate } from 'react-router-dom';

export default function Landing() {
  const { isAuthenticated, authLoading } = useAuth();
  if (!authLoading && isAuthenticated) return <Navigate to="/home" replace />;

  return (
    <div className="App">
      <nav className="nav">
        <div className="nav-logo">binge.</div>
        <div className="nav-links">
          <Link to="/login">Log in</Link>
          <Link to="/signup" className="btn-primary">Sign Up</Link>
        </div>
      </nav>

      <section className="hero">
        <div className="hero-content">
          <h1>Track everything you watch and read.</h1>
          <p className="hero-subtitle">
            Rate, review, and discover movies, TV shows, and books. See what your friends are into.
          </p>
          <div className="hero-actions">
            <Link to="/signup" className="btn-primary btn-large">Get Started — It's Free</Link>
            <a href="#features" className="btn-secondary btn-large">Learn More</a>
          </div>
          {authLoading && <p className="hero-subtitle">Restoring your session...</p>}
        </div>
        <div className="hero-media-grid">
          <div className="media-card">
            <div className="media-card-placeholder"></div>
            <div className="star-rating">★★★★★</div>
          </div>
          <div className="media-card">
            <div className="media-card-placeholder"></div>
            <div className="star-rating">★★★★☆</div>
          </div>
          <div className="media-card">
            <div className="media-card-placeholder"></div>
            <div className="star-rating">★★★★★</div>
          </div>
          <div className="media-card">
            <div className="media-card-placeholder"></div>
            <div className="star-rating">★★★☆☆</div>
          </div>
        </div>
      </section>

      <section className="features" id="features">
        <h2>Everything in one place</h2>
        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-icon">★</div>
            <h3>Rate & Review</h3>
            <p>Give star ratings and write reviews for movies, TV shows, and books all in one place.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">◎</div>
            <h3>Track Your Progress</h3>
            <p>Keep a watchlist, mark what you've seen, and track books you're currently reading.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">♦</div>
            <h3>Discover New Titles</h3>
            <p>Get recommendations based on your taste and see what's trending in the community.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">◈</div>
            <h3>Follow Friends</h3>
            <p>See your friends' ratings and reviews. Find out what they loved — and what to skip.</p>
          </div>
        </div>
      </section>

      <section className="categories">
        <h2>Movies. TV. Books.</h2>
        <p>One account covers everything you consume.</p>
        <div className="categories-grid">
          <div className="category-card movies">
            <h3>Movies</h3>
            <p>From blockbusters to arthouse</p>
          </div>
          <div className="category-card tv">
            <h3>TV Shows</h3>
            <p>Series, miniseries, and documentaries</p>
          </div>
          <div className="category-card books">
            <h3>Books</h3>
            <p>Fiction, non-fiction, and everything between</p>
          </div>
        </div>
      </section>

      <section className="cta" id="sign-up">
        <h2>Start tracking today.</h2>
        <p>Join thousands of people who never lose track of what they want to watch or read next.</p>
        <div className="cta-buttons">
          <Link to="/signup" className="btn-primary btn-large">Create Free Account</Link>
          <Link to="/login" className="btn-secondary btn-large">Log In</Link>
        </div>
      </section>

      <footer className="footer">
        <div className="footer-logo">binge.</div>
        <p>© 2026 · All rights reserved</p>
      </footer>
    </div>
  );
}
