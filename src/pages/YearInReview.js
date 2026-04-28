import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { computeNormalizedScore } from '../components/RatingArtifact';
import { fetchSupabaseRatings, fetchSupabaseWatchlist } from '../utils/supabaseData';
import { buildHomeInsights } from '../homeInsights';

function resolvePoster(url) {
  if (!url) return null;
  try { if (url.includes('plex.tv')) { const inner = new URL(url).searchParams.get('url'); if (inner) return decodeURIComponent(inner); } } catch {}
  return url;
}

const TYPE_LABELS = { movie: 'Movie', tv_show: 'TV Show', book: 'Book' };
const TYPE_ICONS  = { movie: '🎬', tv_show: '📺', book: '📖' };

function StatBig({ value, label, sub, inlineSub = false }) {
  return (
    <div className="yir-stat">
      <span className="yir-stat-num">{value}</span>
      <span className="yir-stat-label-row">
        <span className="yir-stat-label">{label}</span>
        {sub && inlineSub && <span className="yir-stat-sub yir-stat-sub--inline">{sub}</span>}
      </span>
      {sub && !inlineSub && <span className="yir-stat-sub">{sub}</span>}
    </div>
  );
}

function MonthChart({ monthly }) {
  const max = Math.max(...monthly.map(m => m.count), 1);
  return (
    <div className="yir-month-chart">
      {monthly.map((m, i) => (
        <div key={i} className="yir-month-col">
          <div className="yir-month-track">
            <div className="yir-month-fill" style={{ height: `${(m.count / max) * 100}%` }} />
          </div>
          <span className="yir-month-label">{m.label}</span>
          {m.count > 0 && <span className="yir-month-count">{m.count}</span>}
        </div>
      ))}
    </div>
  );
}

export default function YearInReview() {
  const [ratings, setRatings]   = useState([]);
  const [watchlist, setWatchlist] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [year, setYear]         = useState(new Date().getFullYear());

  useEffect(() => {
    Promise.all([fetchSupabaseRatings(), fetchSupabaseWatchlist()])
      .then(([r, w]) => { setRatings(Array.isArray(r) ? r : []); setWatchlist(Array.isArray(w) ? w : []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const insights = useMemo(() => buildHomeInsights(ratings, watchlist, year), [ratings, watchlist, year]);
  const recap = insights.recap;

  const availableYears = useMemo(() => insights.availableYears, [insights]);

  const topRated = useMemo(() => {
    const inYear = ratings.filter(r => r.created_at && new Date(r.created_at).getFullYear() === year);
    return [...inYear].sort((a, b) => (computeNormalizedScore(b.media_type, b) || 0) - (computeNormalizedScore(a.media_type, a) || 0)).slice(0, 6);
  }, [ratings, year]);

  const completed = useMemo(() => {
    return watchlist.filter(i => {
      if (i.status !== 'watched' && i.status !== 'read') return false;
      const ts = i.completed_at || i.updated_at;
      return ts && new Date(ts).getFullYear() === year;
    });
  }, [watchlist, year]);

  const genreMap = useMemo(() => {
    const m = {};
    topRated.forEach(r => {
      (r.genre || '').split(',').forEach(g => {
        const t = g.trim();
        if (t) m[t] = (m[t] || 0) + 1;
      });
    });
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [topRated]);

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content">
        <div className="page-header">
          <p className="page-kicker">Personal stats</p>
          <h1>Year in Review</h1>
          <p className="page-subtitle">Your complete snapshot for the year.</p>
        </div>

        <div className="yir-year-picker">
          {availableYears.map(y => (
            <button key={y} type="button" className={`yir-year-btn${year === y ? ' active' : ''}`} onClick={() => setYear(y)}>
              {y}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="loading-state">Loading your stats…</div>
        ) : recap.totalLogged === 0 ? (
          <div className="empty-state">
            <p>No ratings logged for {year}.</p>
            <Link to="/movies" className="btn-secondary" style={{ marginTop: '1rem', display: 'inline-block' }}>Browse the catalog</Link>
          </div>
        ) : (
          <>
            {/* ── Big numbers ──────────────────────────────────── */}
            <div className="yir-stats-row">
              <StatBig value={recap.totalLogged} label="Titles Logged" />
              <StatBig value={recap.countsByType.movie} label="Movies" sub={TYPE_ICONS.movie} inlineSub />
              <StatBig value={recap.countsByType.tv_show} label="TV Shows" sub={TYPE_ICONS.tv_show} inlineSub />
              <StatBig value={recap.countsByType.book} label="Books" sub={TYPE_ICONS.book} inlineSub />
              <StatBig value={recap.activeMonths} label="Active Months" />
              {recap.busiestMonth && <StatBig value={recap.busiestMonth.label} label="Busiest Month" />}
            </div>

            {/* ── Monthly chart ─────────────────────────────────── */}
            <div className="yir-card">
              <h3>Monthly Pace</h3>
              <MonthChart monthly={recap.monthly} />
            </div>

            {/* ── Top genres ────────────────────────────────────── */}
            {genreMap.length > 0 && (
              <div className="yir-card">
                <h3>Top Genres</h3>
                <div className="yir-genre-list">
                  {genreMap.map(([genre, count]) => (
                    <div key={genre} className="yir-genre-row">
                      <span className="yir-genre-name">{genre}</span>
                      <div className="yir-genre-bar-wrap">
                        <div className="yir-genre-bar" style={{ width: `${(count / genreMap[0][1]) * 100}%` }} />
                      </div>
                      <span className="yir-genre-count">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Top rated ─────────────────────────────────────── */}
            {topRated.length > 0 && (
              <div className="yir-card">
                <h3>Highest Rated This Year</h3>
                <div className="yir-top-grid">
                  {topRated.map(r => {
                    const score = computeNormalizedScore(r.media_type, r);
                    const poster = resolvePoster(r.image_url);
                    return (
                      <div key={`${r.media_type}-${r.media_id}`} className="yir-top-card">
                        <div className="yir-top-poster">
                          {poster
                            ? <img src={poster} alt={r.title} referrerPolicy="no-referrer" />
                            : <div className="yir-top-poster-placeholder">{TYPE_ICONS[r.media_type]}</div>}
                        </div>
                        <p className="yir-top-title">{r.title}</p>
                        {score !== null && <p className="yir-top-score">{score}/10</p>}
                        <span className="yir-top-type">{TYPE_LABELS[r.media_type]}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Completed items ───────────────────────────────── */}
            {completed.length > 0 && (
              <div className="yir-card">
                <h3>Completed This Year ({completed.length})</h3>
                <div className="yir-completed-list">
                  {completed.slice(0, 20).map((item, i) => (
                    <div key={i} className="yir-completed-row">
                      <span>{TYPE_ICONS[item.media_type]}</span>
                      <span className="yir-completed-title">{item.title || `ID ${item.media_id}`}</span>
                    </div>
                  ))}
                  {completed.length > 20 && <p className="yir-completed-more">+{completed.length - 20} more</p>}
                </div>
              </div>
            )}

            {/* ── Badges ───────────────────────────────────────── */}
            {insights.badges.some(b => b.completed) && (
              <div className="yir-card">
                <h3>Badges Earned</h3>
                <div className="yir-badges-row">
                  {insights.badges.filter(b => b.completed).map(badge => (
                    <div key={badge.id} className={`yir-badge badge-card-tier-${badge.displayTier.key}`}>
                      <span className="yir-badge-name">{badge.name}</span>
                      <span className="yir-badge-tier">{badge.statusLabel}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
