import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../utils/supabase';
import { posterSrc } from '../../utils/imageQuality';

function Bars({ series, label }) {
  const max = Math.max(1, ...series.map((point) => point.count));
  return (
    <figure className="adm-bars" aria-label={label}>
      <figcaption>{label}</figcaption>
      <div className="adm-bars-row">
        {series.map((point) => (
          <div key={point.day} className="adm-bar" title={`${point.day}: ${point.count}`}>
            <span style={{ height: `${Math.max(3, (point.count / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="adm-bars-axis"><span>{series[0]?.day?.slice(5)}</span><span>today</span></div>
    </figure>
  );
}

// Dashboard: who's here, what they're watching, and whether anything needs
// attention (errors, servers).
export default function AdminOverview({ onOpenTab }) {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    supabase.rpc('admin_stats').then(({ data, error: rpcError }) => {
      if (rpcError) setError(rpcError.message);
      else setStats(data);
    });
  }, []);

  if (error) return <p className="adm-empty" role="alert">Couldn’t load stats: {error}</p>;
  if (!stats) return <div className="adm-skeleton skeleton-block" aria-hidden="true" />;

  const tiles = [
    ['Users', stats.users_total, `+${stats.users_new_7d} this week`],
    ['Active today', stats.active_24h, `${stats.active_7d} this week · ${stats.active_30d} this month`],
    ['Ratings', stats.ratings_total, `${stats.list_total} on lists`],
    ['Push devices', stats.push_devices, `${stats.reminders_pending} reminders pending`],
    ['Followed teams', stats.followed_teams, 'close-game alerts'],
    ['Errors (24h)', stats.errors_24h, stats.errors_24h ? 'needs a look' : 'all clear', stats.errors_24h ? 'errors' : null],
  ];

  return (
    <div className="adm-overview">
      <dl className="adm-tiles">
        {tiles.map(([label, value, sub, tab]) => (
          <div key={label} className={`adm-tile${tab ? ' adm-tile--alert' : ''}`}>
            <dt>{label}</dt>
            <dd>{Number(value || 0).toLocaleString()}</dd>
            {tab ? <button type="button" className="adm-tile-link" onClick={() => onOpenTab(tab)}>{sub} →</button> : <span>{sub}</span>}
          </div>
        ))}
      </dl>

      <div className="adm-charts">
        <Bars series={stats.active_by_day || []} label="Active viewers per day (14 days)" />
        <Bars series={stats.signups_by_day || []} label="New sign-ups per day (14 days)" />
      </div>

      <section className="adm-panel" aria-labelledby="adm-top-title">
        <h3 id="adm-top-title">Most watched this week</h3>
        {(stats.top_titles || []).length === 0 ? <p className="adm-empty">Nothing played this week yet.</p> : (
          <ol className="adm-top">
            {stats.top_titles.map((title) => (
              <li key={`${title.media_type}:${title.media_id}`}>
                {title.poster_url ? <img src={posterSrc(title.poster_url)} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="adm-top-ph" />}
                <Link to={title.media_type === 'tv_show' ? `/tv-show/${title.media_id}` : `/movie/${title.media_id}`}>{title.title || `#${title.media_id}`}</Link>
                <span className="adm-muted">{title.viewers} viewer{title.viewers === 1 ? '' : 's'}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
