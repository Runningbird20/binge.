import { useState } from 'react';

export default function StarRating({ value, onChange, readOnly = false }) {
  const [hovered, setHovered] = useState(0);
  const display = hovered || value || 0;

  return (
    <div className={`star-rating-input ${readOnly ? 'readonly' : ''}`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <span
          key={star}
          className={star <= display ? 'star filled' : 'star'}
          onMouseEnter={() => !readOnly && setHovered(star)}
          onMouseLeave={() => !readOnly && setHovered(0)}
          onClick={(event) => {
            event.stopPropagation();
            if (!readOnly && onChange) {
              onChange(star);
            }
          }}
        >
          ★
        </span>
      ))}
    </div>
  );
}
