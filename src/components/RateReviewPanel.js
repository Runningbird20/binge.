import { useEffect, useRef, useState } from 'react';
import StarRating from './StarRating';
import RatingInput from './RatingInput';
import { RATING_CATEGORIES, computeStarRating, buildUniformCategories } from './RatingArtifact';

const REVIEW_SAVE_DEBOUNCE_MS = 600;

function extractCategories(mediaType, value) {
  const categories = RATING_CATEGORIES[mediaType] || [];
  const result = {};
  categories.forEach((category) => {
    if (value && value[category.key] != null) {
      result[category.key] = Number(value[category.key]);
    }
  });
  return result;
}

// Quick score by default (writes the same value across every category via
// buildUniformCategories, matching what the rest of the app already reads),
// with an optional expander for real per-category values plus an always-on
// review field — both save through the same onSave(categories, review) call.
export default function RateReviewPanel({ mediaType, value, onSave, allowActions = true, size = 'lg', actions = null }) {
  const [draftStars, setDraftStars] = useState(0);
  const [draftCategories, setDraftCategories] = useState({});
  const [reviewDraft, setReviewDraft] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const reviewSaveTimer = useRef(null);

  useEffect(() => {
    const stars = computeStarRating(mediaType, value) || 0;
    const explicitCategories = extractCategories(mediaType, value);
    setDraftStars(stars);
    setDraftCategories(
      Object.keys(explicitCategories).length ? explicitCategories : buildUniformCategories(mediaType, stars)
    );
    setReviewDraft(value?.review || '');
  }, [value, mediaType]);

  useEffect(() => () => {
    if (reviewSaveTimer.current) clearTimeout(reviewSaveTimer.current);
  }, []);

  async function persist(categories, review) {
    if (typeof onSave !== 'function') return;
    setIsSaving(true);
    try {
      await onSave(categories, review);
    } finally {
      setIsSaving(false);
    }
  }

  function handleStarChange(nextValue) {
    if (!allowActions) return;
    const categories = buildUniformCategories(mediaType, nextValue);
    setDraftStars(nextValue);
    setDraftCategories(categories);
    persist(categories, reviewDraft);
  }

  function handleCategoryChange(updatedCategories) {
    if (!allowActions) return;
    setDraftCategories(updatedCategories);
    setDraftStars(computeStarRating(mediaType, updatedCategories) || 0);
    persist(updatedCategories, reviewDraft);
  }

  function handleReviewChange(event) {
    const text = event.target.value;
    setReviewDraft(text);
    if (!allowActions) return;
    if (reviewSaveTimer.current) clearTimeout(reviewSaveTimer.current);
    reviewSaveTimer.current = setTimeout(() => {
      persist(draftCategories, text);
    }, REVIEW_SAVE_DEBOUNCE_MS);
  }

  function handleReviewBlur() {
    if (!allowActions) return;
    if (reviewSaveTimer.current) {
      clearTimeout(reviewSaveTimer.current);
      reviewSaveTimer.current = null;
    }
    persist(draftCategories, reviewDraft);
  }

  const hasDetailCategories = (RATING_CATEGORIES[mediaType] || []).length > 0;

  return (
    <div className="rate-review-panel">
      <div className="rate-review-quick-row">
        <StarRating
          value={draftStars}
          onChange={allowActions ? handleStarChange : undefined}
          readOnly={!allowActions}
          size={size}
        />
        {actions}
      </div>

      {allowActions && hasDetailCategories && (
        <button
          type="button"
          className="rate-review-detail-toggle"
          onClick={() => setDetailOpen((open) => !open)}
        >
          {detailOpen ? 'Hide detailed rating' : 'Rate in detail →'}
        </button>
      )}

      {detailOpen && (
        <RatingInput mediaType={mediaType} value={draftCategories} onChange={handleCategoryChange} />
      )}

      <div>
        <p className="rate-review-label">Review</p>
        <textarea
          className="rate-review-textarea"
          value={reviewDraft}
          onChange={handleReviewChange}
          onBlur={handleReviewBlur}
          placeholder="Share your thoughts on this title (only visible to you)..."
          disabled={!allowActions}
        />
      </div>

      {isSaving && <span className="rating-saving-hint">Saving...</span>}
    </div>
  );
}
