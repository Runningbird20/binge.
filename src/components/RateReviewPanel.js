import { useEffect, useState } from 'react';
import { ArrowRight } from '@phosphor-icons/react';
import StarRating from './StarRating';
import RatingInput from './RatingInput';
import { RATING_CATEGORIES, computeStarRating, buildUniformCategories } from './RatingArtifact';

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

// Quick stars and optional per-category ratings share the same save action.
export default function RateReviewPanel({ mediaType, value, onSave, allowActions = true, size = 'lg', actions = null }) {
  const [draftStars, setDraftStars] = useState(0);
  const [draftCategories, setDraftCategories] = useState({});
  const [detailOpen, setDetailOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const stars = computeStarRating(mediaType, value) || 0;
    const explicitCategories = extractCategories(mediaType, value);
    setDraftStars(stars);
    setDraftCategories(
      Object.keys(explicitCategories).length ? explicitCategories : buildUniformCategories(mediaType, stars)
    );
  }, [value, mediaType]);

  async function persist(categories) {
    if (typeof onSave !== 'function') return;
    setIsSaving(true);
    try {
      await onSave(categories);
    } finally {
      setIsSaving(false);
    }
  }

  function handleStarChange(nextValue) {
    if (!allowActions) return;
    const categories = buildUniformCategories(mediaType, nextValue);
    setDraftStars(nextValue);
    setDraftCategories(categories);
    persist(categories);
  }

  function handleCategoryChange(updatedCategories) {
    if (!allowActions) return;
    setDraftCategories(updatedCategories);
    setDraftStars(computeStarRating(mediaType, updatedCategories) || 0);
    persist(updatedCategories);
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
          {detailOpen ? 'Hide detailed rating' : <>Rate in detail <ArrowRight size={14} weight="bold" aria-hidden="true" /></>}
        </button>
      )}

      {detailOpen && (
        <RatingInput mediaType={mediaType} value={draftCategories} onChange={handleCategoryChange} />
      )}

      {isSaving && <span className="rating-saving-hint">Saving...</span>}
    </div>
  );
}
