import { useState, useEffect } from 'react';
import { fetchSupabaseMovieCuratedRows } from '../utils/supabaseMovieCatalog';
import { saveSupabaseRating } from '../utils/supabaseData';

const RATING_COLUMNS = {
  movie:   ['acting', 'writing', 'originality', 'pacing', 'cinematography'],
  tv_show: ['premise', 'originality', 'acting', 'cinematography', 'writing', 'pacing', 'resonance'],
  book:    ['prose', 'plot', 'characters', 'originality', 'pacing', 'resonance'],
};

function buildCategories(mediaType, score) {
  const cols = RATING_COLUMNS[mediaType] || RATING_COLUMNS.movie;
  return Object.fromEntries(cols.map(c => [c, score]));
}

function ProgressDots({ current, total }) {
  return (
    <div className="ob-dots">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`ob-dot${i === current ? ' active' : ''}`} />
      ))}
    </div>
  );
}

const FEATURES = [
  { icon: '⭐', title: 'Rate & Review', desc: 'Multi-dimensional scores for movies, TV, and books.' },
  { icon: '📋', title: 'Track & Watch', desc: 'Watchlist, progress tracking, and status per title.' },
];

export default function Onboarding({ onComplete }) {
  const [step, setStep]       = useState(0); // 0=welcome 1=features 2=rate 3=done
  const [picks, setPicks]     = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [rated, setRated]     = useState({});

  const TOTAL_STEPS = 4;

  useEffect(() => {
    if (step === 2 && !picks.length) {
      setLoading(true);
      fetchSupabaseMovieCuratedRows()
        .then(rows => {
          // Exclude the upcoming row — users can't rate films that aren't out yet
          const items = rows
            .filter(r => r.id !== 'upcoming')
            .flatMap(r => r.items || [])
            .slice(0, 9);
          setPicks(items);
        })
        .catch(() => setPicks([]))
        .finally(() => setLoading(false));
    }
  }, [step, picks.length]);

  function handleRate(item, score) {
    setRated(r => ({ ...r, [`${item.media_type || 'movie'}:${item.id}`]: score }));
  }

  async function handleFinishRating() {
    const entries = Object.entries(rated);
    if (entries.length > 0) {
      setSaving(true);
      await Promise.allSettled(
        entries.map(([key, score]) => {
          const [mediaType, mediaIdStr] = key.split(':');
          const mediaId = Number(mediaIdStr);
          const normScore = Math.max(1, Math.min(5, score)); // 1-5 → use as-is (scale matches)
          return saveSupabaseRating({
            mediaType,
            mediaId,
            categories: buildCategories(mediaType, normScore),
          });
        })
      );
      setSaving(false);
    }
    setStep(3);
  }

  if (step === 0) return (
    <div className="onboarding-overlay">
      <div className="onboarding-modal">
        <ProgressDots current={0} total={TOTAL_STEPS} />
        <div className="onboarding-icon">🦉</div>
        <h2>Welcome to binge.</h2>
        <p>Your personal library for everything you watch and read — with social features built in.</p>
        <div className="onboarding-actions">
          <button className="btn-primary" onClick={() => setStep(1)} type="button">Get started →</button>
          <button className="btn-ghost" onClick={onComplete} type="button">Skip for now</button>
        </div>
      </div>
    </div>
  );

  if (step === 1) return (
    <div className="onboarding-overlay">
      <div className="onboarding-modal onboarding-modal--wide">
        <ProgressDots current={1} total={TOTAL_STEPS} />
        <h2>Here's what you can do</h2>
        <div className="ob-features">
          {FEATURES.map(f => (
            <div key={f.title} className="ob-feature">
              <span className="ob-feature-icon">{f.icon}</span>
              <div>
                <p className="ob-feature-title">{f.title}</p>
                <p className="ob-feature-desc">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="onboarding-actions">
          <button className="btn-primary" onClick={() => setStep(2)} type="button">Quick-rate some titles →</button>
          <button className="btn-ghost" onClick={onComplete} type="button">Skip</button>
        </div>
      </div>
    </div>
  );

  if (step === 2) return (
    <div className="onboarding-overlay">
      <div className="onboarding-modal onboarding-modal--wide">
        <ProgressDots current={2} total={TOTAL_STEPS} />
        <h2>Rate titles you've seen</h2>
        <p className="onboarding-sub">Tap stars for anything you've watched. Skip ones you haven't.</p>
        {loading ? (
          <div className="loading-state">Loading titles…</div>
        ) : (
          <div className="onboarding-picks">
            {picks.map(item => {
              const key = `${item.media_type || 'movie'}:${item.id}`;
              const myScore = rated[key] || 0;
              return (
                <div key={key} className="onboarding-pick-card">
                  {item.poster_url
                    ? <img src={item.poster_url} alt={item.title} className="onboarding-pick-poster" referrerPolicy="no-referrer" />
                    : <div className="onboarding-pick-placeholder">🎬</div>
                  }
                  <p className="onboarding-pick-title">{item.title}</p>
                  <div className="onboarding-stars">
                    {[1,2,3,4,5].map(s => (
                      <button key={s} type="button"
                        className={`onboarding-star${myScore >= s ? ' active' : ''}`}
                        onClick={() => handleRate(item, myScore === s ? 0 : s)}
                      >★</button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="onboarding-actions">
          <button className="btn-primary" onClick={handleFinishRating} disabled={saving} type="button">
            {saving ? 'Saving…' : `Done${Object.keys(rated).length > 0 ? ` (${Object.keys(rated).length} rated)` : ''} →`}
          </button>
          <button className="btn-ghost" onClick={onComplete} type="button">Skip</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-modal">
        <ProgressDots current={3} total={TOTAL_STEPS} />
        <div className="onboarding-icon">🎉</div>
        <h2>You're all set!</h2>
        <p>
          {Object.keys(rated).length > 0
            ? `We saved your ${Object.keys(rated).length} rating${Object.keys(rated).length > 1 ? 's' : ''} and will tailor recommendations to your taste.`
            : 'Browse the catalog whenever you\'re ready to start logging titles.'}
        </p>
        <button className="btn-primary" onClick={onComplete} type="button">Go to home →</button>
      </div>
    </div>
  );
}
