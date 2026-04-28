export const RATING_CATEGORIES = {
  movie: [
    { key: 'acting',        label: 'Acting',       max: 5 },
    { key: 'writing',       label: 'Writing',      max: 5 },
    { key: 'originality',   label: 'Originality',  max: 5 },
    { key: 'pacing',        label: 'Pacing',       max: 5 },
    { key: 'cinematography',label: 'Cinema.',      max: 5 },
  ],
  tv_show: [
    { key: 'premise',       label: 'Premise',      max: 5 },
    { key: 'originality',   label: 'Originality',  max: 5 },
    { key: 'acting',        label: 'Acting',       max: 5 },
    { key: 'cinematography',label: 'Cinema.',      max: 5 },
    { key: 'writing',       label: 'Writing',      max: 5 },
    { key: 'pacing',        label: 'Pacing',       max: 5 },
    { key: 'resonance',     label: 'Resonance',    max: 5 },
  ],
  book: [
    { key: 'prose',         label: 'Prose',        max: 5 },
    { key: 'plot',          label: 'Plot',         max: 5 },
    { key: 'characters',    label: 'Characters',   max: 5 },
    { key: 'originality',   label: 'Originality',  max: 5 },
    { key: 'pacing',        label: 'Pacing',       max: 5 },
    { key: 'resonance',     label: 'Resonance',    max: 5 },
  ],
};

const PALETTE = {
  movie:   { primary: '#e8c97a', fill: 'rgba(232,201,122,0.20)', glow: 'rgba(232,201,122,0.18)', grid: 'rgba(232,201,122,0.13)' },
  tv_show: { primary: '#a07de8', fill: 'rgba(160,125,232,0.20)', glow: 'rgba(160,125,232,0.18)', grid: 'rgba(160,125,232,0.13)' },
  book:    { primary: '#5db88a', fill: 'rgba(93,184,138,0.20)',  glow: 'rgba(93,184,138,0.18)',  grid: 'rgba(93,184,138,0.13)'  },
};

export function computeNormalizedScore(mediaType, scores) {
  const cats = RATING_CATEGORIES[mediaType];
  if (!cats || !scores) return null;
  const total = cats.reduce((sum, cat) => sum + (scores[cat.key] || 0), 0);
  const max   = cats.reduce((sum, cat) => sum + cat.max, 0);
  if (!total) return null;
  return Math.round((total / max) * 100) / 10; // 0-10 with one decimal
}

export default function RatingArtifact({ mediaType, scores, size = 280 }) {
  const cats = RATING_CATEGORIES[mediaType] || [];
  if (!cats.length || !scores) return null;

  const cx = size / 2;
  const cy = size / 2;
  const maxR  = size * 0.285;   // polygon radius
  const lblR  = size * 0.425;   // label distance from center
  const n     = cats.length;
  const pal   = PALETTE[mediaType] || PALETTE.movie;
  const glowId = `glow-${mediaType}`;
  const bgId   = `bg-${mediaType}`;

  const ang = (i) => (i * 2 * Math.PI) / n - Math.PI / 2;

  const pt = (i, frac) => ({
    x: cx + maxR * frac * Math.cos(ang(i)),
    y: cy + maxR * frac * Math.sin(ang(i)),
  });

  const polyPts = (fracs) =>
    fracs.map((f, i) => `${pt(i, f).x.toFixed(2)},${pt(i, f).y.toFixed(2)}`).join(' ');

  const normalized = cats.map((cat) => (scores[cat.key] || 0) / cat.max);
  const hasScores  = normalized.some((v) => v > 0);

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="rating-artifact"
      overflow="visible"
      role="img"
      aria-label="Rating visualization"
    >
      <defs>
        <filter id={glowId} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="3.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <radialGradient id={bgId} cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor={pal.glow} />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
      </defs>

      {/* Ambient background glow */}
      <circle cx={cx} cy={cy} r={maxR * 1.25} fill={`url(#${bgId})`} />

      {/* Grid rings at 25 / 50 / 75 / 100 % */}
      {[0.25, 0.5, 0.75, 1.0].map((level) => (
        <polygon
          key={level}
          points={polyPts(cats.map(() => level))}
          fill="none"
          stroke={level === 1.0 ? pal.grid.replace('0.13', '0.22') : pal.grid}
          strokeWidth={level === 1.0 ? 1.2 : 0.8}
        />
      ))}

      {/* Axis spokes */}
      {cats.map((_, i) => {
        const end = pt(i, 1);
        return (
          <line
            key={i}
            x1={cx} y1={cy}
            x2={end.x} y2={end.y}
            stroke={pal.grid}
            strokeWidth="0.8"
          />
        );
      })}

      {/* Score fill polygon */}
      {hasScores && (
        <polygon
          points={polyPts(normalized)}
          fill={pal.fill}
          stroke={pal.primary}
          strokeWidth="2"
          strokeLinejoin="round"
          filter={`url(#${glowId})`}
        />
      )}

      {/* Vertex dots */}
      {hasScores && cats.map((_, i) => {
        if (!normalized[i]) return null;
        const p = pt(i, normalized[i]);
        return (
          <circle
            key={i}
            cx={p.x} cy={p.y}
            r="4.5"
            fill={pal.primary}
            filter={`url(#${glowId})`}
          />
        );
      })}

      {/* Category labels */}
      {cats.map((cat, i) => {
        const a   = ang(i);
        const lx  = cx + lblR * Math.cos(a);
        const ly  = cy + lblR * Math.sin(a);
        const cos = Math.cos(a);
        const anchor = cos > 0.3 ? 'start' : cos < -0.3 ? 'end' : 'middle';
        const score  = scores[cat.key];

        return (
          <g key={i}>
            <text
              x={lx} y={ly - 5}
              textAnchor={anchor}
              fontSize="9.5"
              fill="rgba(255,255,255,0.5)"
              fontFamily="inherit"
            >
              {cat.label}
            </text>
            <text
              x={lx} y={ly + 9}
              textAnchor={anchor}
              fontSize="11"
              fontWeight="700"
              fill={score ? pal.primary : 'rgba(255,255,255,0.18)'}
              fontFamily="inherit"
            >
              {score ? `${score}/${cat.max}` : '—'}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
