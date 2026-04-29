import { useRef, useState, useEffect } from 'react';
import RatingArtifact, { computeNormalizedScore } from './RatingArtifact';
import ThemedSelect from './ThemedSelect';
import { fetchSupabaseLists, addSupabaseListItem } from '../utils/supabaseData';
import { useToast } from '../contexts/ToastContext';

function resolvePosterUrl(url) {
  if (!url) return null;
  try {
    if (url.includes('plex.tv')) {
      const inner = new URL(url).searchParams.get('url');
      if (inner) return decodeURIComponent(inner);
    }
  } catch { /* fall through */ }
  return url;
}

async function shareItem(item) {
  const text = `${item.title}${item.year ? ` (${item.year})` : ''}`;
  const url = window.location.href;
  if (navigator.share) {
    try { await navigator.share({ title: 'binge.', text: `Check out ${text} on binge!`, url }); return 'shared'; }
    catch { return null; }
  }
  try { await navigator.clipboard.writeText(`${text} — ${url}`); return 'copied'; }
  catch { return null; }
}

function ListQuickAddMobile({ mediaType, mediaId, itemTitle }) {
  const [open, setOpen] = useState(false);
  const [lists, setLists] = useState(null);
  const [selectedId, setSelectedId] = useState('');
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  async function handleOpen(e) {
    e.stopPropagation();
    setOpen(o => !o);
    if (lists === null) {
      try {
        const data = await fetchSupabaseLists();
        const editable = Array.isArray(data) ? data.filter(l => l?.permissions?.canEdit) : [];
        setLists(editable);
        setSelectedId(editable[0] ? String(editable[0].id) : '');
      } catch { setLists([]); }
    }
  }

  async function handleAdd(e) {
    e.stopPropagation();
    if (!selectedId) return;
    setSaving(true);
    try {
      await addSupabaseListItem(selectedId, { mediaType, mediaId });
      const name = lists?.find(l => String(l.id) === selectedId)?.name;
      toast(`Added to ${name || 'list'}`);
      setTimeout(() => setOpen(false), 300);
    } catch (err) {
      toast(err.message || 'Could not add to list', 'error');
    } finally { setSaving(false); }
  }

  return (
    <div className="mob-card-list-wrap" ref={panelRef}>
      <button type="button" className="mob-card-action-btn" onClick={handleOpen} title="Add to list">
        + List
      </button>
      {open && (
        <div className="mob-card-list-panel" onClick={e => e.stopPropagation()}>
          {lists === null ? (
            <span className="mob-card-list-msg">Loading…</span>
          ) : lists.length === 0 ? (
            <span className="mob-card-list-msg">No editable lists</span>
          ) : (
            <>
              <ThemedSelect
                className="mc-list-select"
                value={selectedId}
                aria-label="Choose list"
                options={lists.map(l => ({ value: l.id, label: l.name }))}
                onChange={e => setSelectedId(e.target.value)}
              />
              <button type="button" className="mob-card-action-btn" onClick={handleAdd} disabled={saving}>
                {saving ? '…' : 'Add'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function MobileMediaCard({
  item,
  mediaType,
  userRating,
  onWatchlist,
  onOpenDetails,
}) {
  const toast = useToast();
  const imageUrl = resolvePosterUrl(item.poster_url || item.cover_url || item.image_url);
  const subtitle = item.director || item.creator || item.author || '';
  const avgRating = item.avg_rating ? Number(item.avg_rating).toFixed(1) : null;
  const userScore = computeNormalizedScore(mediaType, userRating);
  const canWatch = mediaType === 'movie' || mediaType === 'tv_show';

  return (
    <div
      className="mob-card"
      onClick={() => onOpenDetails?.(item)}
      role={onOpenDetails ? 'button' : undefined}
      tabIndex={onOpenDetails ? 0 : undefined}
      onKeyDown={(e) => {
        if (!onOpenDetails) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenDetails(item); }
      }}
    >
      {/* Thumbnail */}
      <div className="mob-card-thumb">
        {imageUrl ? (
          <img src={imageUrl} alt={item.title} referrerPolicy="no-referrer" loading="lazy" decoding="async" />
        ) : (
          <div className="mob-card-thumb-placeholder">
            <span>{item.title?.charAt(0)}</span>
          </div>
        )}
        {userRating && (
          <div className="mob-card-badge">
            <RatingArtifact mediaType={mediaType} scores={userRating} size={44} />
          </div>
        )}
      </div>

      {/* Body */}
      <div className="mob-card-body">
        <h3 className="mob-card-title">{item.title}</h3>

        <div className="mob-card-meta">
          {item.year && <span>{item.year}</span>}
          {item.genre && <span className="mob-card-genre">{item.genre}</span>}
          {subtitle && <span className="mob-card-creator">{subtitle}</span>}
        </div>

        <div className="mob-card-scores">
          {userScore !== null && (
            <span className="mob-card-user-score">You: {userScore}/10</span>
          )}
          {avgRating && (
            <span className="mob-card-avg-score">★ {avgRating}</span>
          )}
        </div>

        {/* Actions */}
        <div className="mob-card-actions" onClick={e => e.stopPropagation()}>
          <button
            type="button"
            className="mob-card-action-btn"
            onClick={() => onOpenDetails?.(item)}
          >
            {userRating ? 'Edit Rating' : 'Rate'}
          </button>
          {onWatchlist && (
            <button
              type="button"
              className="mob-card-action-btn"
              onClick={() => onWatchlist(item)}
            >
              + Library
            </button>
          )}
          <ListQuickAddMobile mediaType={mediaType} mediaId={item.id} itemTitle={item.title} />
          {canWatch && (
            <button
              type="button"
              className="mob-card-action-btn mob-card-action-btn--watch"
              onClick={() => onOpenDetails?.(item)}
            >
              ▶ Watch
            </button>
          )}
          <button
            type="button"
            className="mob-card-action-btn mob-card-action-btn--icon"
            title="Share"
            onClick={async (e) => {
              e.stopPropagation();
              const result = await shareItem(item);
              if (result === 'copied') toast('Link copied to clipboard', 'info');
            }}
          >
            ↗
          </button>
        </div>
      </div>
    </div>
  );
}
