export default function RatingBadge({ value, size = 'sm', corner = false }) {
  if (value == null) return null;

  const display = Number(value).toFixed(1);
  const className = [
    'rating-badge',
    `rating-badge-${size}`,
    corner ? 'rating-badge--corner' : '',
  ].filter(Boolean).join(' ');

  return (
    <span className={className} title={`Rated ${display}/5`}>
      <span className="rating-badge-num">{display}</span>
      <span className="rating-badge-den">/5</span>
    </span>
  );
}
