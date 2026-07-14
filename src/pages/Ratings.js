import { useState, useEffect } from 'react';
import Navbar from '../components/Navbar';
import StarRating from '../components/StarRating';
import { computeStarRating } from '../components/RatingArtifact';
import { fetchSupabaseRatings } from '../utils/supabaseData';

const TYPE_LABELS = { movie: 'Movie', tv_show: 'TV Show', book: 'Book' };
const TYPE_TABS   = [
  { key: 'all',    label: 'All' },
  { key: 'movie',  label: 'Movies' },
  { key: 'tv_show',label: 'TV Shows' },
  { key: 'book',   label: 'Books' },
];

export default function Ratings() {
  const [ratings, setRatings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('all');

  useEffect(() => {
    setLoading(true);
    fetchSupabaseRatings()
      .then(setRatings)
      .catch(() => setRatings([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = activeTab === 'all'
    ? ratings
    : ratings.filter((r) => r.media_type === activeTab);

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content">
        <div className="page-header">
          <p className="page-kicker">Your Library</p>
          <h1>My Ratings</h1>
          <p className="page-subtitle">
            Every title you've rated, out of 5 stars.
          </p>
        </div>

        <section className="surface-panel">
          <div className="tabs">
            {TYPE_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={`tab-btn${activeTab === tab.key ? ' tab-btn-active' : ''}`}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
                {tab.key !== 'all' && (
                  <span className="tab-count">
                    {ratings.filter((r) => r.media_type === tab.key).length}
                  </span>
                )}
                {tab.key === 'all' && (
                  <span className="tab-count">{ratings.length}</span>
                )}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="loading-state">Loading your ratings...</div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <p>No ratings yet{activeTab !== 'all' ? ` for ${TYPE_LABELS[activeTab]}s` : ''}.</p>
              <p className="empty-hint">Rate a title from the Movies, TV Shows, or Books pages.</p>
            </div>
          ) : (
            <div className="ratings-page-grid">
              {filtered.map((rating) => {
                const stars = computeStarRating(rating.media_type, rating);
                return (
                  <div key={`${rating.media_type}-${rating.media_id}`} className="ratings-page-card">
                    <div className="ratings-page-poster-wrap">
                      {rating.image_url ? (
                        <img
                          src={rating.image_url}
                          alt={rating.title || 'Poster'}
                          className="ratings-page-poster"
                        />
                      ) : (
                        <div className="ratings-page-poster-placeholder">
                          {(rating.title || '?').charAt(0)}
                        </div>
                      )}
                    </div>

                    <div className="ratings-page-info">
                      <span className={`ratings-page-type-badge ratings-page-type-${rating.media_type}`}>
                        {TYPE_LABELS[rating.media_type]}
                      </span>
                      <h3 className="ratings-page-title">{rating.title || `ID ${rating.media_id}`}</h3>
                      {rating.year && <p className="ratings-page-year">{rating.year}</p>}

                      {stars !== null && (
                        <div className="ratings-page-stars">
                          <StarRating value={stars} readOnly size="md" />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
