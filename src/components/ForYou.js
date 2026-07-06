import { useState } from 'react';
import { api } from '../api';

const MEDIA_ICONS = { movie: '🎬', tv_show: '📺', book: '📚' };
const MEDIA_LABELS = { movie: 'Movie', tv_show: 'TV Show', book: 'Book' };

function RecommendationCard({ rec }) {
  return (
    <a href={rec.siteUrl} className="foryou-card">
      <div className="foryou-card-poster">
        {rec.posterUrl ? (
          <img src={rec.posterUrl} alt={rec.title} />
        ) : (
          <div className="foryou-card-placeholder">
            {MEDIA_ICONS[rec.media_type]}
          </div>
        )}
      </div>
      <div className="foryou-card-body">
        <div className="foryou-card-type">
          {MEDIA_ICONS[rec.media_type]} {MEDIA_LABELS[rec.media_type]}
          {rec.year && <span className="foryou-card-year">{rec.year}</span>}
        </div>
        <h4 className="foryou-card-title">{rec.title}</h4>
        {rec.genre && <p className="foryou-card-genre">{rec.genre.split(',')[0].trim()}</p>}
        <p className="foryou-card-reason">✨ {rec.reason}</p>
      </div>
    </a>
  );
}

export default function ForYou() {
  const [state, setState] = useState('idle'); // idle | loading | done | error | empty
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  async function fetchRecommendations() {
    setState('loading');
    setError('');
    try {
      const result = await api.get('/chat/recommendations');
      if (result.recommendations?.length === 0) {
        setState('empty');
        setData(result);
      } else {
        setData(result);
        setState('done');
      }
    } catch (err) {
      setError(err.message || 'Something went wrong.');
      setState('error');
    }
  }

  return (
    <section className="home-section foryou-section">
      <div className="section-header">
        <h2>🦉 For You</h2>
        {state === 'done' && (
          <button className="foryou-refresh-btn" onClick={fetchRecommendations}>
            Refresh
          </button>
        )}
      </div>

      {state === 'idle' && (
        <div className="foryou-idle">
          <p className="foryou-idle-text">
            Get personalized picks based on everything you've rated — we'll match your taste against the catalog and surface hidden gems just for you.
          </p>
          <button type="button" className="foryou-generate-btn" onClick={e => { e.preventDefault(); e.stopPropagation(); fetchRecommendations(); }}>
            Generate My Recommendations
          </button>
        </div>
      )}

      {state === 'loading' && (
        <div className="foryou-loading">
          <div className="foryou-loading-owl">🦉</div>
          <p>Analyzing your taste...</p>
          <div className="foryou-loading-dots"><span /><span /><span /></div>
        </div>
      )}

      {state === 'error' && (
        <div className="foryou-error">
          <p>⚠️ {error}</p>
          <button type="button" className="foryou-generate-btn" onClick={e => { e.preventDefault(); e.stopPropagation(); fetchRecommendations(); }}>Try again</button>
        </div>
      )}

      {state === 'empty' && (
        <div className="foryou-idle">
          <p className="foryou-idle-text">
            {data?.message || 'Rate some movies, TV shows, or books first to unlock personalized recommendations!'}
          </p>
          <a href="/movies" className="foryou-generate-btn" style={{ textDecoration: 'none', display: 'inline-block' }}>
            Browse & Rate Media
          </a>
        </div>
      )}

      {state === 'done' && data && (
        <>
          {data.tasteProfile && (
            <div className="foryou-taste-profile">
              <span className="foryou-taste-label">Your taste</span>
              <p>{data.tasteProfile}</p>
            </div>
          )}
          <div className="foryou-grid">
            {data.recommendations.map(rec => (
              <RecommendationCard key={`${rec.media_type}:${rec.id}`} rec={rec} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
