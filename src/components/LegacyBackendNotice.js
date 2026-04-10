import { Link } from 'react-router-dom';

export default function LegacyBackendNotice({
  featureName = 'This feature',
  isProtected = false,
}) {
  return (
    <div className="app-layout">
      <main className="page-content">
        <div className="page-header">
          <p className="page-kicker">Legacy Feature</p>
          <h1>{featureName} still uses the old backend</h1>
          <p className="page-subtitle books-page-subtitle">
            The rest of the app now runs through Supabase, but this screen has not been migrated yet.
          </p>
        </div>

        <section className="surface-panel">
          <div className="empty-state">
            <p>
              To use {featureName.toLowerCase()}, start the Express server and enable the legacy
              backend flag in your frontend environment.
            </p>
            <p className="empty-hint">
              Add <code>REACT_APP_ENABLE_LEGACY_BACKEND=true</code> only if you still want to run
              the old server-backed routes.
            </p>
            <p className="empty-hint">
              {isProtected
                ? 'The Supabase-backed pages that are ready now are Movies, TV Shows, Books, Watchlist, Ratings, and Account Settings.'
                : 'Public shared-list links also still depend on the old Express routes for now.'}
            </p>
            <Link to={isProtected ? '/home' : '/'} className="btn-secondary">
              Back to {isProtected ? 'dashboard' : 'home'}
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
