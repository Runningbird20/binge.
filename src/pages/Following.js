import { useEffect, useMemo, useState } from 'react';
import Navbar from '../components/Navbar';
import UserAvatar from '../components/UserAvatar';
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

function formatRelativeDate(timestamp) {
  const createdAt = new Date(timestamp).getTime();
  const diffMs = Date.now() - createdAt;
  if (diffMs < 60_000) {
    return 'just now';
  }
  if (diffMs < 3_600_000) {
    return `${Math.round(diffMs / 60_000)}m ago`;
  }
  if (diffMs < 86_400_000) {
    return `${Math.round(diffMs / 3_600_000)}h ago`;
  }
  return `${Math.round(diffMs / 86_400_000)}d ago`;
}

function FeedItem({ item }) {
  const action = item.type === 'rating' ? 'reviewed' : 'added to their library';
  const headline = item.type === 'rating'
    ? `Reviewed ${item.title}`
    : `Saved ${item.title}`;

  return (
    <article className="social-feed-item surface-panel">
      <div className="social-feed-header">
        <div className="social-feed-author">
          <UserAvatar avatarUrl={item.author.avatar_url} name={item.author.username} size="sm" />
          <div>
            <p className="social-feed-author-name">{item.author.username}</p>
            <p className="social-feed-meta">{formatRelativeDate(item.createdAt)}</p>
          </div>
        </div>
        <span className="social-feed-action">{action}</span>
      </div>
      <div className="social-feed-body">
        <h3>{headline}</h3>
        <p className="social-feed-subtitle">
          {item.mediaType.replace('_', ' ')} · {item.year || 'Unknown year'}
        </p>
        {item.type === 'rating' && item.review && (
          <p className="social-feed-review">{item.review}</p>
        )}
        {item.type === 'library' && (
          <p className="social-feed-review">Status: {item.status.replace('_', ' ')}</p>
        )}
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

  useEffect(() => {
    let active = true;

    async function loadSocialData() {
      setLoading(true);
      setError('');

      try {
        const [ratings, followed, suggestions] = await Promise.all([
          fetchSupabaseRatings(),
          fetchSupabaseFollowingIds(),
          fetchSupabaseProfiles({ excludeUserId: user?.id, limit: null }),
        ]);

        if (!active) {
          return;
        }

        setCurrentRatings(ratings);
        setSuggestedProfiles(suggestions.filter((profile) => profile.id !== user?.id && !followed.includes(profile.id)));

        if (followed.length) {
          const [profiles, feed] = await Promise.all([
            fetchSupabaseProfilesByIds(followed),
            fetchSupabaseFollowFeed(),
          ]);

          if (!active) {
            return;
          }

          setFollowingProfiles(profiles);
          setFeedItems(feed);
        } else {
          setFollowingProfiles([]);
          setFeedItems([]);
        }
      } catch (err) {
        if (active) {
          setError(err?.message || 'Unable to load your social feed.');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadSocialData();
    return () => {
      active = false;
    };
  }, [user?.id]);

  const filteredSuggestions = useMemo(() => {
    const normalized = searchQuery.trim().toLowerCase();
    if (!normalized) {
      return suggestedProfiles;
    }

    return suggestedProfiles.filter((profile) =>
      profile.username.toLowerCase().includes(normalized)
    );
  }, [searchQuery, suggestedProfiles]);

  const ratingByUser = useMemo(() => {
    return feedItems.reduce((acc, item) => {
      if (item.type !== 'rating') {
        return acc;
      }
      acc[item.userId] = acc[item.userId] || [];
      acc[item.userId].push(item);
      return acc;
    }, {});
  }, [feedItems]);

  async function handleFollow(profileId) {
    if (!profileId || profileId === user?.id) {
      setError('You cannot follow yourself.');
      return;
    }

    setSavingProfileId(profileId);
    setError('');

    try {
      await followSupabaseUser(profileId);
      const refreshedFollowedIds = await fetchSupabaseFollowingIds();
      const refreshedProfiles = await fetchSupabaseProfilesByIds(refreshedFollowedIds);
      const refreshedFeed = await fetchSupabaseFollowFeed();
      setFollowingProfiles(refreshedProfiles);
      setFeedItems(refreshedFeed);
      setSuggestedProfiles((current) => current.filter((profile) => profile.id !== profileId));
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
      <main className="page-content">
        <div className="page-header">
          <p className="page-kicker">Following</p>
          <div>
            <h1>Stay connected to the taste-makers you trust.</h1>
            <p className="page-subtitle">
              Follow members to surface their latest logs, reviews, and library activity in one personalized feed.
            </p>
          </div>
        </div>

        {error && <div className="auth-error">{error}</div>}

        <section className="surface-panel">
          <div className="section-header">
            <div>
              <h2>Your network</h2>
              <p>Follow members to see curated activity and taste match scores for shared ratings.</p>
            </div>
          </div>

          {loading ? (
            <div className="loading-state">Loading your following list...</div>
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

        <section className="surface-panel">
          <div className="section-header">
            <div>
              <h2>Latest activity</h2>
              <p>Your personalized feed from people you follow.</p>
            </div>
          </div>

          {loading ? (
            <div className="loading-state">Loading feed...</div>
          ) : feedItems.length === 0 ? (
            <div className="empty-state">
              <p>No activity yet.</p>
              <p className="empty-hint">Follow someone to populate your feed with their latest logs and reviews.</p>
            </div>
          ) : (
            <div className="social-feed-list">
              {feedItems.map((item) => (
                <FeedItem key={`${item.type}-${item.id}-${item.createdAt}`} item={item} />
              ))}
            </div>
          )}
        </section>

        <section className="surface-panel">
          <div className="section-header">
            <div>
              <h2>Other Taste-makers</h2>
              <p>Search and follow other members to broaden your personalized feed.</p>
            </div>
            <label className="filter-input-label">
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search taste-makers"
                className="filter-input"
                aria-label="Search taste-makers by username"
              />
            </label>
          </div>

          {loading ? (
            <div className="loading-state">Loading suggestions...</div>
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
