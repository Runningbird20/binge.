import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import ProfileAvatar from '../ProfileAvatar';
import UserAvatar from '../UserAvatar';
import { computeStarRating } from '../RatingArtifact';
import { excludeRated, computeWatchMinutes, countCompleted } from '../../utils/libraryStats';

// Home's one line of stats (time watched, completed, in progress, ratings),
// the same math as the Profile page (utils/libraryStats.js).
export default function ProfileStatsHeader({ user, activeProfile, watchlist, ratings }) {
  const stats = useMemo(() => {
    // Rated titles move to Ratings & Reviews, so in-progress (a library-only
    // status) is measured against the watchlist minus anything already rated.
    const libraryWatchlist = excludeRated(watchlist, ratings);
    const completed  = countCompleted(watchlist, ratings);
    const inProgress = libraryWatchlist.filter(i => i.status === 'watching' || i.status === 'reading').length;

    const scores = ratings.map(r => computeStarRating(r.media_type, r)).filter(s => s != null);
    const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : '—';

    // Watch time counts both watchlist progress and rated titles (a rating
    // means it was watched, even if never marked "watched" in the library).
    const minutes = computeWatchMinutes(watchlist, ratings);

    return { completed, inProgress, avg, minutes, totalRatings: ratings.length };
  }, [watchlist, ratings]);

  const hours = Math.round(stats.minutes / 60);
  const editTo = activeProfile && !activeProfile.is_default ? '/profiles' : '/account-settings';
  const tiles = [
    { label: 'Watched', value: hours >= 2 ? `${hours.toLocaleString()}h` : `${stats.minutes}m` },
    { label: 'Completed', value: stats.completed },
    { label: 'In progress', value: stats.inProgress },
    { label: 'Ratings', value: stats.totalRatings },
    { label: 'Avg score', value: stats.avg },
  ];

  // Same look as the Profile page header (pf-*), condensed for Home.
  return (
    <section className="hm-me" aria-label="Your stats">
      <Link to="/profile" className="hm-me-id">
        {activeProfile ? (
          <ProfileAvatar profile={activeProfile} size={56} />
        ) : (
          <UserAvatar avatarUrl={user.avatarUrl} name={user.username} size="lg" />
        )}
        <span className="hm-me-text">
          <span className="hm-me-name">{activeProfile?.name || user.username}</span>
        </span>
      </Link>
      <dl className="pf-stats hm-me-stats">
        {tiles.map((tile) => (
          <div key={tile.label}><dt>{tile.label}</dt><dd>{tile.value}</dd></div>
        ))}
      </dl>
      <Link to={editTo} className="st-btn st-btn--ghost hm-me-edit">
        {activeProfile && !activeProfile.is_default ? 'Manage profiles' : 'Edit profile'}
      </Link>
    </section>
  );
}
