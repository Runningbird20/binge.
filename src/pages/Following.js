import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import UserAvatar from '../components/UserAvatar';
import UserProfileModal from '../components/UserProfileModal';
import { useAuth } from '../contexts/AuthContext';
import {
  calculateTasteMatch,
  fetchSupabaseFollowFeed,
  fetchSupabaseFollowingIds,
  fetchSupabaseProfiles,
  fetchSupabaseProfilesByIds,
  fetchSupabaseRatings,
  followSupabaseUser,
  unfollowSupabaseUser,
} from '../utils/supabaseData';

const MEDIA_TYPE_LABELS = { movie: 'Movie', tv_show: 'TV Show', book: 'Book' };
const ACTION_LABELS = { rating: '⭐ Reviewed', library: '📚 Added to library' };

function formatRelativeDate(timestamp) {
  const diffMs = Date.now() - new Date(timestamp).getTime();
  if (diffMs < 60_000) return 'just now';
  if (diffMs < 3_600_000) return `${Math.round(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.round(diffMs / 3_600_000)}h ago`;
  return `${Math.round(diffMs / 86_400_000)}d ago`;
}

function FeedItem({ item }) {
  return (
    <article className="social-feed-item">
      <div className="social-feed-header">
        <Link to={`/profile/${item.author.username}`} className="social-feed-author">
          <UserAvatar avatarUrl={item.author.avatar_url} name={item.author.username} size="sm" />
          <div>
            <p className="social-feed-author-name">{item.author.username}</p>
            <p className="social-feed-meta">{formatRelativeDate(item.createdAt)}</p>
          </div>
        </Link>
        <span className="social-feed-action-badge">{ACTION_LABELS[item.type] || item.type}</span>
      </div>
      <div className="social-feed-body">
        <h3>{item.title}</h3>
        <p className="social-feed-subtitle">
          {MEDIA_TYPE_LABELS[item.mediaType] || item.mediaType}
          {item.year ? ` · ${item.year}` : ''}
        </p>
        {item.type === 'rating' && item.review && (
          <p className="social-feed-review">"{item.review}"</p>
        )}
        {item.type === 'library' && (
          <p className="social-feed-status-pill">{item.status.replace(/_/g, ' ')}</p>
        )}
      </div>
    </article>
  );
}

function TasteBar({ pct }) {
  const color = pct >= 70 ? '#4caf82' : pct >= 40 ? '#e8c97a' : '#e87a7a';
  return (
    <div className="social-taste-row">
      <span className="social-taste-label">Taste match</span>
      <div className="social-taste-track">
        <div className="social-taste-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="social-taste-pct" style={{ color }}>{pct}%</span>
    </div>
  );
}

function FollowingCard({ profile, tasteMatch, onUnfollow, onQuickView, saving }) {
  return (
    <article className="social-profile-card-v2">
      <div className="social-profile-card-header">
        <button
          type="button"
          className="social-avatar-btn"
          onClick={() => onQuickView(profile)}
          aria-label={`Quick view ${profile.username}`}
        >
          <UserAvatar avatarUrl={profile.avatar_url} name={profile.username} size="md" />
        </button>
        <div className="social-profile-card-info">
          <Link to={`/profile/${profile.username}`} className="social-profile-name-link">
            {profile.username}
          </Link>
          <p className="social-profile-bio">{profile.bio || 'No bio yet.'}</p>
        </div>
      </div>
      <TasteBar pct={tasteMatch} />
      <div className="social-profile-card-actions">
        <Link to={`/profile/${profile.username}`} className="btn-ghost btn-sm">
          View Profile
        </Link>
        <button
          className="social-unfollow-btn"
          type="button"
          onClick={() => onUnfollow(profile.id)}
          disabled={saving}
        >
          Unfollow
        </button>
      </div>
    </article>
  );
}

function SuggestionCard({ profile, onFollow, onQuickView, saving }) {
  return (
    <article className="social-profile-card-v2">
      <div className="social-profile-card-header">
        <button
          type="button"
          className="social-avatar-btn"
          onClick={() => onQuickView(profile)}
          aria-label={`Quick view ${profile.username}`}
        >
          <UserAvatar avatarUrl={profile.avatar_url} name={profile.username} size="md" />
        </button>
        <div className="social-profile-card-info">
          <Link to={`/profile/${profile.username}`} className="social-profile-name-link">
            {profile.username}
          </Link>
          <p className="social-profile-bio">{profile.bio || 'No bio yet.'}</p>
        </div>
      </div>
      <div className="social-profile-card-actions">
        <Link to={`/profile/${profile.username}`} className="btn-ghost btn-sm">
          View Profile
        </Link>
        <button
          className="btn-primary btn-sm"
          type="button"
          onClick={() => onFollow(profile.id)}
          disabled={saving}
        >
          Follow
        </button>
      </div>
    </article>
  );
}

export default function Following() {
  const { user } = useAuth();
  const [followingProfiles, setFollowingProfiles] = useState([]);
  const [feedItems, setFeedItems] = useState([]);
  const [suggestedProfiles, setSuggestedProfiles] = useState([]);
  const [currentRatings, setCurrentRatings] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingProfileId, setSavingProfileId] = useState(null);
  const [error, setError] = useState('');
  const [modalProfile, setModalProfile] = useState(null);

  useEffect(() => {
    let active = true;

    async function loadSocialData() {
      setLoading(true);
      setError('');

      try {
        const [ratings, followed, suggestions] = await Promise.all([
          fetchSupabaseRatings(),
          fetchSupabaseFollowingIds(),
          fetchSupabaseProfiles({ excludeUserId: user?.id }),
        ]);

        if (!active) return;

        setCurrentRatings(ratings);
        setSuggestedProfiles(suggestions.filter((profile) => profile.id !== user?.id && !followed.includes(profile.id)));

        if (followed.length) {
          const [profiles, feed] = await Promise.all([
            fetchSupabaseProfilesByIds(followed),
            fetchSupabaseFollowFeed(),
          ]);
          if (!active) return;
          setFollowingProfiles(profiles);
          setFeedItems(feed);
        } else {
          setFollowingProfiles([]);
          setFeedItems([]);
        }
      } catch (err) {
        if (active) setError(err?.message || 'Unable to load your social feed.');
      } finally {
        if (active) setLoading(false);
      }
    }

    loadSocialData();
    return () => { active = false; };
  }, [user?.id]);

  const filteredSuggestions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return q
      ? suggestedProfiles.filter((p) => p.username.toLowerCase().includes(q))
      : suggestedProfiles;
  }, [searchQuery, suggestedProfiles]);

  const ratingByUser = useMemo(() =>
    feedItems.reduce((acc, item) => {
      if (item.type !== 'rating') return acc;
      acc[item.userId] = acc[item.userId] || [];
      acc[item.userId].push(item);
      return acc;
    }, {}),
  [feedItems]);

  async function handleFollow(profileId) {
    if (!profileId || profileId === user?.id) {
      setError('You cannot follow yourself.');
      return;
    }

    setSavingProfileId(profileId);
    setError('');
    try {
      await followSupabaseUser(profileId);
      const ids = await fetchSupabaseFollowingIds();
      const [profiles, feed] = await Promise.all([
        fetchSupabaseProfilesByIds(ids),
        fetchSupabaseFollowFeed(),
      ]);
      setFollowingProfiles(profiles);
      setFeedItems(feed);
      setSuggestedProfiles((cur) => cur.filter((p) => p.id !== profileId));
    } catch (err) {
      setError(err?.message || 'Unable to follow that member.');
    } finally {
      setSavingProfileId(null);
    }
  }

  async function handleUnfollow(profileId) {
    if (!profileId) {
      setError('Choose a member to unfollow.');
      return;
    }

    setSavingProfileId(profileId);
    setError('');
    const unfollowedProfile = followingProfiles.find((profile) => profile.id === profileId);

    try {
      await unfollowSupabaseUser(profileId);
      const refreshedFollowedIds = await fetchSupabaseFollowingIds();
      const refreshedProfiles = await fetchSupabaseProfilesByIds(refreshedFollowedIds);
      const refreshedFeed = await fetchSupabaseFollowFeed();
      setFollowingProfiles(refreshedProfiles);
      setFeedItems(refreshedFeed);
      if (unfollowedProfile && unfollowedProfile.id !== user?.id) {
        setSuggestedProfiles((current) => {
          if (current.some((profile) => profile.id === unfollowedProfile.id)) {
            return current;
          }
          return [unfollowedProfile, ...current].slice(0, 6);
        });
      }
    } catch (err) {
      setError(err?.message || 'Unable to unfollow that member.');
    } finally {
      setSavingProfileId(null);
    }
  }

  return (
    <div className="app-layout">
      <Navbar />
      {modalProfile && (
        <UserProfileModal profile={modalProfile} onClose={() => setModalProfile(null)} />
      )}

      <main className="page-content">
        <div className="page-header">
          <p className="page-kicker">Following</p>
          <div>
            <h1>Your taste-maker network</h1>
            <p className="page-subtitle">
              Follow members to surface their latest reviews and library activity in one personalized feed.
            </p>
          </div>
        </div>

        {error && <div className="auth-error">{error}</div>}

        {/* Your network */}
        <section className="surface-panel">
          <div className="section-header">
            <div>
              <h2>
                Following
                {followingProfiles.length > 0 && (
                  <span className="section-count-badge">{followingProfiles.length}</span>
                )}
              </h2>
              <p>Taste match scores are based on your shared ratings.</p>
            </div>
          </div>

          {loading ? (
            <div className="loading-state">Loading your network...</div>
          ) : followingProfiles.length === 0 ? (
            <div className="empty-state">
              <p>You are not following anyone yet.</p>
              <p className="empty-hint">Follow someone below to build your personalized feed.</p>
            </div>
          ) : (
            <div className="social-grid">
              {followingProfiles.length === 0 ? (
                <div className="empty-state">
                  <p>You are not following anyone yet.</p>
                  <p className="empty-hint">Start by following a member below to build your personalized feed.</p>
                </div>
              ) : (
                followingProfiles.map((profile) => (
                  <article key={profile.id} className="social-profile-card surface-panel">
                    <div className="social-profile-card-header">
                      <UserAvatar avatarUrl={profile.avatar_url} name={profile.username} size="md" />
                      <div>
                        <p className="social-profile-name">{profile.username}</p>
                        <p className="social-profile-bio">{profile.bio || 'No bio yet.'}</p>
                      </div>
                    </div>
                    <div className="social-profile-meta">
                      <span>Taste match</span>
                      <strong>{calculateTasteMatch(currentRatings, ratingByUser[profile.id] || [])}%</strong>
                    </div>
                    <button
                      className="btn-ghost"
                      type="button"
                      onClick={() => handleUnfollow(profile.id)}
                      disabled={savingProfileId === profile.id}
                    >
                      {savingProfileId === profile.id ? 'Saving...' : 'Unfollow'}
                    </button>
                  </article>
                ))
              )}
            </div>
          )}
        </section>

        {/* Activity feed */}
        <section className="surface-panel">
          <div className="section-header">
            <div>
              <h2>Latest activity</h2>
              <p>Recent reviews and library additions from people you follow.</p>
            </div>
          </div>

          {loading ? (
            <div className="loading-state">Loading feed...</div>
          ) : feedItems.length === 0 ? (
            <div className="empty-state">
              <p>No activity yet.</p>
              <p className="empty-hint">Follow someone to populate your feed.</p>
            </div>
          ) : (
            <div className="social-feed-list">
              {feedItems.map((item) => (
                <FeedItem key={`${item.type}-${item.id}-${item.createdAt}`} item={item} />
              ))}
            </div>
          )}
        </section>

        {/* Discover section */}
        <section className="surface-panel">
          <div className="section-header">
            <div>
              <h2>Discover taste-makers</h2>
              <p>Find and follow other members to broaden your feed.</p>
            </div>
            <label className="filter-input-label">
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by username"
                className="filter-input"
                aria-label="Search taste-makers by username"
              />
            </label>
          </div>

          {loading ? (
            <div className="loading-state">Loading suggestions...</div>
          ) : filteredSuggestions.length === 0 ? (
            <div className="empty-state">
              <p>No matching members found.</p>
              <p className="empty-hint">Try a different username or clear the search.</p>
            </div>
          ) : (
            <div className="social-grid">
              {filteredSuggestions.length === 0 ? (
                <div className="empty-state">
                  <p>No matching members found.</p>
                  <p className="empty-hint">Try another username or clear the search.</p>
                </div>
              ) : (
                filteredSuggestions.map((profile) => (
                  <article key={profile.id} className="social-profile-card surface-panel">
                    <div className="social-profile-card-header">
                      <UserAvatar avatarUrl={profile.avatar_url} name={profile.username} size="md" />
                      <div>
                        <p className="social-profile-name">{profile.username}</p>
                        <p className="social-profile-bio">{profile.bio || 'No bio yet.'}</p>
                      </div>
                    </div>
                    <button
                      className="btn-primary"
                      type="button"
                      onClick={() => handleFollow(profile.id)}
                      disabled={savingProfileId === profile.id}
                    >
                      {savingProfileId === profile.id ? 'Saving...' : 'Follow'}
                    </button>
                  </article>
                ))
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
