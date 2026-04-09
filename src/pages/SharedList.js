import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api';

function getTypeLabel(mediaType) {
  if (mediaType === 'movie') return 'Movie';
  if (mediaType === 'tv_show') return 'TV Show';
  return 'Book';
}

function getImageUrl(item) {
  const rawUrl = item.image_url || '';
  if (!rawUrl) return '';
  if (rawUrl.startsWith('//')) return `https:${rawUrl}`;
  if (rawUrl.startsWith('http://')) return rawUrl.replace(/^http:\/\//i, 'https://');
  return rawUrl;
}

function rankItemsByVibe(items) {
  return [...items].sort((left, right) => {
    if ((right.vibe_score || 0) !== (left.vibe_score || 0)) {
      return (right.vibe_score || 0) - (left.vibe_score || 0);
    }
    if ((right.upvotes || 0) !== (left.upvotes || 0)) {
      return (right.upvotes || 0) - (left.upvotes || 0);
    }
    if ((left.downvotes || 0) !== (right.downvotes || 0)) {
      return (left.downvotes || 0) - (right.downvotes || 0);
    }
    return (left.position || 0) - (right.position || 0);
  });
}

function VibeVoteControls({ item, onVote, disabled }) {
  return (
    <div className="vibe-vote-controls" aria-label={`Vibe voting for ${item.title}`}>
      <button
        type="button"
        className={`vibe-vote-btn${item.my_vote === 1 ? ' is-active' : ''}`}
        onClick={() => onVote(item, item.my_vote === 1 ? 0 : 1)}
        disabled={disabled}
        aria-label={`Upvote ${item.title}`}
      >
        +
      </button>
      <span className="vibe-vote-score">{item.vibe_score}</span>
      <button
        type="button"
        className={`vibe-vote-btn${item.my_vote === -1 ? ' is-active is-negative' : ' is-negative'}`}
        onClick={() => onVote(item, item.my_vote === -1 ? 0 : -1)}
        disabled={disabled}
        aria-label={`Downvote ${item.title}`}
      >
        -
      </button>
    </div>
  );
}

export default function SharedList() {
  const { shareCode } = useParams();
  const { user } = useAuth();
  const [list, setList] = useState(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  async function loadList({ silent = false } = {}) {
    if (!shareCode) {
      setErrorMessage('Missing list link.');
      setLoading(false);
      return;
    }

    if (!silent) {
      setLoading(true);
    }

    try {
      const data = await api.get(`/lists/shared/${shareCode}`);
      setList(data);
      setErrorMessage('');
    } catch (error) {
      setList(null);
      setErrorMessage(error.message);
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      if (!cancelled) {
        await loadList({ silent: false });
      }
    }

    refresh();

    const intervalId = window.setInterval(() => {
      if (!cancelled) {
        loadList({ silent: true });
      }
    }, 8000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [shareCode]);

  async function handleVote(item, value) {
    if (!list?.permissions?.canVote) return;

    setWorking(true);
    setStatusMessage('');

    try {
      const updatedList = await api.post(`/lists/${list.id}/items/${item.id}/vote`, { value });
      setList(updatedList);
    } catch (error) {
      setStatusMessage(error.message);
    } finally {
      setWorking(false);
    }
  }

  async function handleMove(item, direction) {
    if (!list?.permissions?.canEdit) return;

    setWorking(true);
    setStatusMessage('');

    try {
      const updatedList = await api.patch(`/lists/${list.id}/items/${item.id}/move`, { direction });
      setList(updatedList);
    } catch (error) {
      setStatusMessage(error.message);
    } finally {
      setWorking(false);
    }
  }

  async function handleRemove(item) {
    if (!list?.permissions?.canEdit) return;
    if (!window.confirm(`Remove "${item.title}" from this list?`)) return;

    setWorking(true);
    setStatusMessage('');

    try {
      const updatedList = await api.delete(`/lists/${list.id}/items/${item.id}`);
      setList(updatedList);
    } catch (error) {
      setStatusMessage(error.message);
    } finally {
      setWorking(false);
    }
  }

  const rankedItems = rankItemsByVibe(list?.items || []);
  const consensusPick = list?.consensus_pick || rankedItems[0] || null;

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content">
        {loading ? (
          <div className="loading-state">Loading shared list...</div>
        ) : errorMessage ? (
          <div className="empty-state">
            <p>{errorMessage}</p>
            <p className="empty-hint">
              If this list is private, make sure you are logged in as an invited collaborator.
            </p>
          </div>
        ) : !list ? (
          <div className="empty-state">
            <p>This list is unavailable.</p>
          </div>
        ) : (
          <>
            <div className="page-header">
              <p className="page-kicker">Shared List</p>
              <div className="lists-detail-title-row">
                <h1>{list.name}</h1>
                <span className={`lists-visibility-badge${list.is_public ? ' is-public' : ''}`}>
                  {list.is_public ? 'Public' : 'Private'}
                </span>
              </div>
              <p className="page-subtitle books-page-subtitle">
                Curated by {list.owner.username}. Anonymous vibe votes update live so the group can converge on a pick.
              </p>
            </div>

            {statusMessage && <div className="status-banner">{statusMessage}</div>}

            {consensusPick && (
              <section className="lists-card lists-consensus-card">
                <div className="lists-card-header">
                  <h2>Current Consensus</h2>
                  <p>The highest-ranked item right now.</p>
                </div>
                <div className="lists-consensus-body">
                  <div>
                    <h3>{consensusPick.title}</h3>
                    <p className="lists-consensus-meta">
                      {getTypeLabel(consensusPick.media_type)}
                      {consensusPick.year ? ` | ${consensusPick.year}` : ''}
                      {consensusPick.creator_name ? ` | ${consensusPick.creator_name}` : ''}
                    </p>
                  </div>
                  <div className="lists-consensus-score">
                    <strong>{consensusPick.vibe_score}</strong>
                    <span>vibe score</span>
                  </div>
                </div>
              </section>
            )}

            <section className="lists-card">
              <div className="lists-members-header">
                <h2>Members</h2>
                <p>{list.collaborators.length} people can edit and vote here.</p>
              </div>
              <div className="lists-member-chip-row">
                {list.collaborators.map((member) => (
                  <div key={`${member.role}-${member.id}`} className="lists-member-chip">
                    <span>{member.username}</span>
                    <small>{member.role}</small>
                  </div>
                ))}
              </div>

              {!list.permissions?.canVote && (
                <p className="lists-page-status">
                  {user
                    ? 'Only invited collaborators can add anonymous vibe votes on this private planning board.'
                    : 'Log in with an invited account to co-edit and vibe-vote on this list.'}
                </p>
              )}
            </section>

            <section className="lists-card">
              <div className="lists-card-header">
                <h2>Vibe Vote Board</h2>
                <p>Ranked by anonymous vote score so the group favorite naturally floats to the top.</p>
              </div>

              {rankedItems.length === 0 ? (
                <div className="empty-state">
                  <p>No titles have been added yet.</p>
                </div>
              ) : (
                <div className="shared-list-item-stack">
                  {rankedItems.map((item, index) => {
                    const imageUrl = getImageUrl(item);

                    return (
                      <article
                        key={item.id}
                        className={`shared-list-item-card${index === 0 ? ' is-consensus-leader' : ''}`}
                      >
                        <div className="shared-list-item-media">
                          <div className="shared-list-item-poster">
                            {imageUrl ? (
                              <img src={imageUrl} alt={item.title} />
                            ) : (
                              <div className="watchlist-placeholder">
                                <span>{item.title?.charAt(0)}</span>
                              </div>
                            )}
                          </div>

                          <div className="shared-list-item-copy">
                            <div className="shared-list-item-title-row">
                              <h3>{item.title}</h3>
                              <div className="shared-list-item-title-badges">
                                {index === 0 && <span className="lists-visibility-badge is-public">Top Pick</span>}
                                <span className="type-badge">{getTypeLabel(item.media_type)}</span>
                              </div>
                            </div>
                            <p className="shared-list-item-meta">
                              {item.creator_name || 'Unknown creator'}
                              {item.year ? ` | ${item.year}` : ''}
                            </p>
                            {item.genre && <p className="shared-list-item-genre">{item.genre}</p>}
                            {item.synopsis && <p className="shared-list-item-synopsis">{item.synopsis}</p>}
                          </div>
                        </div>

                        <div className="shared-list-item-actions">
                          <VibeVoteControls
                            item={item}
                            onVote={handleVote}
                            disabled={working || !list.permissions?.canVote}
                          />
                          <p className="shared-list-item-vibe-copy">
                            {item.upvotes} up / {item.downvotes} down
                          </p>

                          {list.permissions?.canEdit && (
                            <div className="shared-list-item-buttons">
                              <button
                                type="button"
                                className="btn-ghost btn-sm"
                                onClick={() => handleMove(item, 'up')}
                                disabled={working}
                              >
                                Move Up
                              </button>
                              <button
                                type="button"
                                className="btn-ghost btn-sm"
                                onClick={() => handleMove(item, 'down')}
                                disabled={working}
                              >
                                Move Down
                              </button>
                              <button
                                type="button"
                                className="btn-ghost btn-sm shared-list-remove-btn"
                                onClick={() => handleRemove(item)}
                                disabled={working}
                              >
                                Remove
                              </button>
                            </div>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
