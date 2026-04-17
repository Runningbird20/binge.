import { useState, useEffect } from 'react';
import { fetchSupabaseRatings, addSupabaseWatchlistItem } from '../utils/supabaseData';
import { fetchSupabaseMovieCuratedRows } from '../utils/supabaseMovieCatalog';

const STEPS = ['welcome', 'rate', 'done'];

export default function Onboarding({ onComplete }) {
  const [step, setStep]       = useState('welcome');
  const [picks, setPicks]     = useState([]);
  const [loading, setLoading] = useState(false);
  const [rated, setRated]     = useState({});

  useEffect(() => {
    if (step === 'rate' && !picks.length) {
      setLoading(true);
      // Load a small set of well-known titles to rate
      fetchSupabaseMovieCuratedRows()
        .then(rows => {
          const items = rows.flatMap(r => r.items || []).slice(0, 8);
          setPicks(items);
        })
        .catch(() => setPicks([]))
        .finally(() => setLoading(false));
    }
  }, [step, picks.length]);

  function handleRate(item, score) {
    setRated(r => ({ ...r, [`${item.media_type || 'movie'}:${item.id}`]: score }));
  }

  function handleSkip() { onComplete?.(); }

  if (step === 'welcome') return (
    <div className="onboarding-overlay">
      <div className="onboarding-modal">
        <div className="onboarding-icon">🦉</div>
        <h2>Welcome to binge.</h2>
        <p>Rate a few titles you've already seen so we can learn your taste and personalize your recommendations right away.</p>
        <div className="onboarding-actions">
          <button className="btn-primary" onClick={() => setStep('rate')} type="button">Let's go →</button>
          <button className="btn-ghost" onClick={handleSkip} type="button">Skip for now</button>
        </div>
      </div>
    </div>
  );

  if (step === 'rate') return (
    <div className="onboarding-overlay">
      <div className="onboarding-modal onboarding-modal--wide">
        <h2>Quick-rate a few titles</h2>
        <p className="onboarding-sub">Tap a score (1–5 stars) or skip titles you haven't seen.</p>
        {loading ? (
          <div className="loading-state">Loading titles...</div>
        ) : (
          <div className="onboarding-picks">
            {picks.map(item => {
              const key = `${item.media_type || 'movie'}:${item.id}`;
              const myScore = rated[key];
              return (
                <div key={key} className="onboarding-pick-card">
                  {item.poster_url
                    ? <img src={item.poster_url} alt={item.title} className="onboarding-pick-poster" />
                    : <div className="onboarding-pick-placeholder">🎬</div>
                  }
                  <p className="onboarding-pick-title">{item.title}</p>
                  <div className="onboarding-stars">
                    {[1,2,3,4,5].map(s => (
                      <button key={s} type="button" className={`onboarding-star ${myScore >= s ? 'active' : ''}`} onClick={() => handleRate(item, s)}>★</button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="onboarding-actions">
          <button className="btn-primary" onClick={() => setStep('done')} type="button">
            Done ({Object.keys(rated).length} rated)
          </button>
          <button className="btn-ghost" onClick={handleSkip} type="button">Skip</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-modal">
        <div className="onboarding-icon">🎉</div>
        <h2>You're all set!</h2>
        <p>We've noted your ratings. Hit "Generate My Recommendations" on the home page whenever you want personalized picks.</p>
        <button className="btn-primary" onClick={onComplete} type="button">Go to home →</button>
      </div>
    </div>
  );
}
