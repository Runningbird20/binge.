import { RATING_CATEGORIES } from './RatingArtifact';

const CATEGORY_DESCRIPTIONS = {
  // Movie
  acting:        'Performance quality of the cast',
  writing:       'Quality of script, dialogue, and story',
  originality:   'How fresh and unique the premise feels',
  pacing:        'Rhythm and flow from start to finish',
  cinematography:'Visual craft, framing, and direction',
  // TV-only
  premise:       'The core idea and how it plays out episode to episode',
  resonance:     'How much it stays with you after watching',
  // Book-only
  prose:         'Quality of the writing craft itself',
  plot:          'Story structure and narrative engagement',
  // Manga-only
  art:           'Quality of the artwork and panel composition',
  story:         'Narrative strength and plot engagement',
  enjoyment:     'Overall fun and satisfaction while reading',
  // Shared
  characters:    'Depth, development, and memorability',
};

export default function RatingInput({ mediaType, value = {}, onChange }) {
  const cats = RATING_CATEGORIES[mediaType] || [];

  function handleScore(key, score) {
    onChange({ ...value, [key]: score });
  }

  return (
    <div className="rating-input">
      {cats.map((cat) => {
        const selected = value[cat.key] || 0;
        return (
          <div key={cat.key} className="rating-input-row">
            <div className="rating-input-label-group">
              <span className="rating-input-label">{cat.label}</span>
              <span className="rating-input-desc">{CATEGORY_DESCRIPTIONS[cat.key] || ''}</span>
            </div>
            <div className="rating-input-buttons">
              {Array.from({ length: cat.max }, (_, idx) => idx + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`rating-btn${selected === n ? ' rating-btn-active' : ''}`}
                  onClick={() => handleScore(cat.key, n)}
                  aria-label={`${cat.label} ${n} of ${cat.max}`}
                  aria-pressed={selected === n}
                >
                  {n}
                </button>
              ))}
              <span className="rating-input-max">/{cat.max}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
