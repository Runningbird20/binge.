import { Link, Navigate } from 'react-router-dom';
import { Books, Sparkle, Subtitles, Trophy } from '@phosphor-icons/react';
import { useAuth } from '../contexts/AuthContext';
import { getDefaultRouteForUserType } from '../utils/userAccess';

const FEATURES = [
  {
    Icon: Sparkle,
    title: 'Picks that explain themselves',
    body: 'Every recommendation says why — "Because you loved Parasite" — and learns from what you watch and how you rate it.',
  },
  {
    Icon: Subtitles,
    title: 'Your language, remembered',
    body: 'Choose original audio and subtitles once. binge. starts each show on the server that worked for you last time.',
  },
  {
    Icon: Trophy,
    title: 'Live sports, one card per game',
    body: 'NFL to the Premier League in league rows — every stream for a game in one place, with a simple server switch.',
  },
  {
    Icon: Books,
    title: 'Movies, series and books',
    body: 'Track what you finish across everything you watch and read, with one taste profile behind all of it.',
  },
];

export default function Landing() {
  const { isAuthenticated, authLoading, user } = useAuth();

  if (!authLoading && isAuthenticated) {
    return <Navigate to={getDefaultRouteForUserType(user)} replace />;
  }

  return (
    <div className="App lp">
      <header className="lp-bar">
        <span className="landing-logo lp-logo">binge.</span>
        <Link to="/login" className="st-btn st-btn--secondary lp-signin">Sign In</Link>
      </header>

      <section
        className="landing-hero lp-hero"
        style={{ backgroundImage: `url(${process.env.PUBLIC_URL}/landing-hero.webp)` }}
      >
        <div className="landing-hero-overlay lp-hero-overlay" aria-hidden="true" />
        <div className="landing-hero-content lp-hero-content">
          <h1 className="landing-hero-title lp-title">Everything you watch and read, in one place.</h1>
          <p className="landing-hero-subtitle lp-subtitle">
            Movies, series, books and live sports — with picks made for you, not for everyone.
          </p>
          <div className="lp-actions">
            <Link to="/signup" className="st-btn st-btn--primary lp-cta">Create Account</Link>
          </div>
        </div>
      </section>

      <section className="lp-features" aria-label="What makes binge. different">
        {FEATURES.map(({ Icon, title, body }) => (
          <article key={title} className="lp-feature">
            <span className="lp-feature-icon"><Icon size={26} weight="duotone" /></span>
            <h2>{title}</h2>
            <p>{body}</p>
          </article>
        ))}
      </section>

      <footer className="lp-footer">
        <span className="landing-logo">binge.</span>
        <span>Made for people who watch a lot.</span>
      </footer>
    </div>
  );
}
