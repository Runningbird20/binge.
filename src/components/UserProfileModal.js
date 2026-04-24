import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import UserAvatar from './UserAvatar';
import { computeNormalizedScore } from './RatingArtifact';

const STATUS_LABELS = {
  watching: 'Watching',
  reading: 'Reading',
  watched: 'Watched',
  read: 'Read',
  plan_to_watch: 'Plan to Watch',
  plan_to_read: 'Plan to Read',
};

const STATUS_COLORS = {
  watching: '#e8c97a',
  reading: '#e8c97a',
  watched: '#4caf82',
  read: '#4caf82',
  plan_to_watch: '#7ab8e8',
  plan_to_read: '#7ab8e8',
};

const TYPE_ICONS = { movie: '🎬', tv_show: '📺', book: '📖' };

function resolvePoster(url) {
  if (!url) return null;
  try {
    if (url.includes('plex.tv')) {
      const inner = new URL(url).searchParams.get('url');
      if (inner) return decodeURIComponent(inner);
    }
  } catch {}
  return url;
}

export default function UserProfileModal({ profile, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const overlayRef = useRef(null);

  useEffect(() => {
    let active = true;
    api.get(`/profile/${profile.username}`)
      .then(d => { if (active) setData(d); })
      .catch(() => {})
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [profile.username]);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  function handleOverlayClick(e) {
    if (e.target === overlayRef.current) onClose();
  }

  const ratings = data?.ratings || [];
  const watchlist = data?.watchlist || [];
  const followers = data?.followers || 0;
  const following = data?.following || 0;

  const activeItems = watchlist.filter(
    item => item.status === 'watching' || item.status === 'reading'
  );

  const topRated = [...ratings]
    .map(r => ({ ...r, _score: computeNormalizedScore(r.media_type, r) }))
    .filter(r => r._score != null)
    .sort((a, b) => b._score - a._score)
    .slice(0, 4);

  return (
    <div
      className="upm-overlay"
      ref={overlayRef}
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-label={`${profile.username}'s profile`}
    >
      <div className="upm-modal">
        <button className="upm-close" onClick={onClose} type="button" aria-label="Close">✕</button>

        {/* Header */}
        <div className="upm-header">
          <UserAvatar avatarUrl={profile.avatar_url} name={profile.username} size="lg" />
          <div className="upm-header-info">
            <h2 className="upm-username">u/{profile.username}</h2>
            {profile.bio && <p className="upm-bio">{profile.bio}</p>}
            <div className="upm-stats">
              <span><strong>{followers}</strong> followers</span>
              <span><strong>{following}</strong> following</span>
              {!loading && <span><strong>{ratings.length}</strong> ratings</span>}
              {!loading && <span><strong>{watchlist.length}</strong> in library</span>}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="upm-loading">Loading profile...</div>
        ) : data?.isPrivate ? (
          <div className="upm-private">🔒 This profile is private.</div>
        ) : (
          <>
            {/* Currently Watching / Reading */}
            {activeItems.length > 0 && (
              <section className="upm-section">
                <h3 className="upm-section-title">Currently Watching / Reading</h3>
                <div className="upm-media-row">
                  {activeItems.slice(0, 5).map((item, i) => {
                    const poster = resolvePoster(item.poster_url);
                    const color = STATUS_COLORS[item.status] || '#777';
                    return (
                      <div key={i} className="upm-media-card">
                        <div className="upm-media-poster">
                          {poster
                            ? <img src={poster} alt={item.title} referrerPolicy="no-referrer" />
                            : <div className="upm-media-placeholder">{TYPE_ICONS[item.media_type]}</div>
                          }
                          <span className="upm-media-status" style={{ color, borderColor: color + '44', background: color + '18' }}>
                            {STATUS_LABELS[item.status]}
                          </span>
                        </div>
                        <p className="upm-media-title">{item.title || '—'}</p>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Top Rated */}
            {topRated.length > 0 && (
              <section className="upm-section">
                <h3 className="upm-section-title">Highest Rated</h3>
                <div className="upm-rated-list">
                  {topRated.map((item, i) => {
                    const poster = resolvePoster(item.image_url);
                    return (
                      <div key={i} className="upm-rated-item">
                        <span className="upm-rated-rank">#{i + 1}</span>
                        <div className="upm-rated-poster">
                          {poster
                            ? <img src={poster} alt={item.title} referrerPolicy="no-referrer" />
                            : <div className="upm-rated-placeholder">{TYPE_ICONS[item.media_type]}</div>
                          }
                        </div>
                        <div className="upm-rated-info">
                          <p className="upm-rated-title">{item.title || '—'}</p>
                          <p className="upm-rated-meta">
                            {TYPE_ICONS[item.media_type]} {item.year || ''}
                          </p>
                          {item.review && <p className="upm-rated-review">"{item.review}"</p>}
                        </div>
                        <span className="upm-rated-score">{item._score}<span>/10</span></span>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {activeItems.length === 0 && topRated.length === 0 && (
              <div className="upm-empty">No public activity yet.</div>
            )}
          </>
        )}

        <div className="upm-footer">
          <Link to={`/profile/${profile.username}`} className="btn-primary" onClick={onClose}>
            View Full Profile →
          </Link>
        </div>
      </div>
    </div>
  );
}
