import { useState } from 'react';

const STARS = [1, 2, 3, 4, 5];

function fractionFor(displayValue, starIndex) {
  const diff = displayValue - (starIndex - 1);
  if (diff >= 1) return 1;
  if (diff >= 0.5) return 0.5;
  return 0;
}

function valueFromPointer(event, starIndex) {
  const rect = event.currentTarget.getBoundingClientRect();
  const isLeftHalf = event.clientX - rect.left < rect.width / 2;
  return isLeftHalf ? starIndex - 0.5 : starIndex;
}

// A single 5-star rating control (half-star precision) used everywhere a
// movie/TV/book rating is shown or collected. Pass onChange for an
// interactive picker; omit it (or pass readOnly) for a plain display.
export default function StarRating({ value = 0, onChange, size = 'md', readOnly = false, label }) {
  const [hoverValue, setHoverValue] = useState(null);
  const interactive = !readOnly && typeof onChange === 'function';
  const displayValue = interactive && hoverValue != null ? hoverValue : (value || 0);

  return (
    <div
      className={`star-rating star-rating-${size}${interactive ? ' star-rating-interactive' : ''}`}
      onMouseLeave={interactive ? () => setHoverValue(null) : undefined}
      role={interactive ? 'radiogroup' : 'img'}
      aria-label={label || (interactive ? 'Your rating out of 5 stars' : `Rated ${value || 0} out of 5 stars`)}
    >
      {STARS.map((starIndex) => {
        const fraction = fractionFor(displayValue, starIndex);
        return (
          <span
            key={starIndex}
            className="star-rating-star"
            onClick={interactive ? (event) => { event.stopPropagation(); onChange(valueFromPointer(event, starIndex)); } : undefined}
            onMouseMove={interactive ? (event) => setHoverValue(valueFromPointer(event, starIndex)) : undefined}
            role={interactive ? 'button' : undefined}
            aria-label={interactive ? `Rate ${starIndex} stars` : undefined}
          >
            <span className="star-rating-star-bg" aria-hidden="true">★</span>
            <span className="star-rating-star-fill" style={{ width: `${fraction * 100}%` }} aria-hidden="true">★</span>
          </span>
        );
      })}
    </div>
  );
}
