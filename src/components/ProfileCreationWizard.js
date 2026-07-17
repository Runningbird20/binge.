import { useEffect, useState } from 'react';
import { Check } from '@phosphor-icons/react';
import { fetchSupabaseMovieCuratedRows } from '../utils/supabaseMovieCatalog';
import { saveSupabaseRating } from '../utils/supabaseData';
import { setActiveProfileId } from '../utils/activeProfile';
import { AVATAR_COLORS, AVATAR_EMOJI } from './ProfileAvatar';

const RATING_COLUMNS = {
  movie: ['acting', 'writing', 'originality', 'pacing', 'cinematography'],
};

function buildCategories(score) {
  return Object.fromEntries(RATING_COLUMNS.movie.map((c) => [c, score]));
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

const TOTAL_STEPS = 5;

// Netflix-style multi-step "Add Profile" flow: picture → name → permissions
// → quick-rate a few titles (so this profile's recommendations aren't cold
// from the very first visit) → done. Mirrors Onboarding.js's rating step
// (same curated rows, same star UI) but scoped to the profile being created.
export default function ProfileCreationWizard({ onCreate, onFinish, onCancel }) {
  const [step, setStep] = useState(0); // 0=picture 1=name 2=permissions 3=rate 4=done
  const [avatarUrl, setAvatarUrl] = useState(AVATAR_EMOJI[0]);
  const [name, setName] = useState('');
  const [isKids, setIsKids] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createdProfile, setCreatedProfile] = useState(null);

  const [picks, setPicks] = useState([]);
  const [loadingPicks, setLoadingPicks] = useState(false);
  const [rated, setRated] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (step === 3 && !picks.length) {
      setLoadingPicks(true);
      fetchSupabaseMovieCuratedRows()
        .then((rows) => {
          const items = rows
            .filter((r) => r.id !== 'upcoming')
            .flatMap((r) => r.items || [])
            .slice(0, 9);
          setPicks(items);
        })
        .catch(() => setPicks([]))
        .finally(() => setLoadingPicks(false));
    }
  }, [step, picks.length]);

  async function handleCreateAndContinue() {
    if (!name.trim()) return;
    setCreating(true);
    setCreateError('');
    try {
      const created = await onCreate({ name: name.trim(), isKids, avatarUrl });
      setCreatedProfile(created);
      // Attribute the upcoming ratings step to this new profile right away —
      // saveSupabaseRating reads the active profile id internally.
      setActiveProfileId(created.id);
      setStep(3);
    } catch (err) {
      setCreateError(err.message || 'Unable to create that profile.');
    } finally {
      setCreating(false);
    }
  }

  function handleRate(item, score) {
    setRated((r) => ({ ...r, [item.id]: score }));
  }

  async function handleFinishRating() {
    const entries = Object.entries(rated);
    if (entries.length > 0) {
      setSaving(true);
      await Promise.allSettled(
        entries.map(([mediaIdStr, score]) => saveSupabaseRating({
          mediaType: 'movie',
          mediaId: Number(mediaIdStr),
          categories: buildCategories(Math.max(1, Math.min(5, score))),
        }))
      );
      setSaving(false);
    }
    setStep(4);
  }

  return (
    <div className="onboarding-overlay" onClick={step < 3 ? onCancel : undefined}>
      <div className={`onboarding-modal${step === 3 ? ' onboarding-modal--wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <ProgressDots current={step} total={TOTAL_STEPS} />

        {step === 0 && (
          <>
            <h2>Choose a picture</h2>
            <div className="profile-avatar-picker profile-avatar-picker--wizard">
              {AVATAR_EMOJI.map((emoji, index) => (
                <button
                  key={emoji}
                  type="button"
                  className={`profile-avatar-picker-option${avatarUrl === emoji ? ' selected' : ''}`}
                  style={{ background: AVATAR_COLORS[index % AVATAR_COLORS.length] }}
                  onClick={() => setAvatarUrl(emoji)}
                >
                  {emoji}
                  {avatarUrl === emoji && <span className="profile-avatar-picker-check"><Check size={12} weight="bold" /></span>}
                </button>
              ))}
            </div>
            <div className="onboarding-actions">
              <button className="btn-primary" type="button" onClick={() => setStep(1)}>Continue →</button>
              <button className="btn-ghost" type="button" onClick={onCancel}>Cancel</button>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h2>What's this profile called?</h2>
            <input
              type="text"
              className="profile-picker-add-input profile-wizard-name-input"
              placeholder="Profile name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
              maxLength={40}
            />
            <div className="onboarding-actions">
              <button className="btn-primary" type="button" onClick={() => setStep(2)} disabled={!name.trim()}>Continue →</button>
              <button className="btn-ghost" type="button" onClick={onCancel}>Cancel</button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2>Set permissions</h2>
            <label className="profile-picker-kids-toggle profile-wizard-kids-toggle">
              <input type="checkbox" checked={isKids} onChange={(event) => setIsKids(event.target.checked)} />
              Kids profile — only shows titles rated G / PG / TV-Y / TV-Y7 / TV-G / TV-PG
            </label>
            {createError && <p className="profile-picker-add-error">{createError}</p>}
            <div className="onboarding-actions">
              <button className="btn-primary" type="button" onClick={handleCreateAndContinue} disabled={creating}>
                {creating ? 'Creating…' : 'Continue →'}
              </button>
              <button className="btn-ghost" type="button" onClick={onCancel} disabled={creating}>Cancel</button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h2>Rate a few titles</h2>
            <p className="onboarding-sub">
              This sharpens {createdProfile?.name || 'this profile'}'s recommendations right away. Tap stars for anything you've seen — skip the rest.
            </p>
            {loadingPicks ? (
              <div className="loading-state">Loading titles…</div>
            ) : (
              <div className="onboarding-picks">
                {picks.map((item) => {
                  const myScore = rated[item.id] || 0;
                  return (
                    <div key={item.id} className="onboarding-pick-card">
                      {item.poster_url
                        ? <img src={item.poster_url} alt={item.title} className="onboarding-pick-poster" referrerPolicy="no-referrer" />
                        : <div className="onboarding-pick-placeholder">🎬</div>}
                      <p className="onboarding-pick-title">{item.title}</p>
                      <div className="onboarding-stars">
                        {[1, 2, 3, 4, 5].map((s) => (
                          <button
                            key={s}
                            type="button"
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
              <button className="btn-primary" type="button" onClick={handleFinishRating} disabled={saving}>
                {saving ? 'Saving…' : `Done${Object.keys(rated).length > 0 ? ` (${Object.keys(rated).length} rated)` : ''} →`}
              </button>
              <button className="btn-ghost" type="button" onClick={() => setStep(4)}>Skip</button>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <div className="onboarding-icon">🎉</div>
            <h2>{createdProfile?.name || 'Profile'} is ready!</h2>
            <p>
              {Object.keys(rated).length > 0
                ? `Saved ${Object.keys(rated).length} rating${Object.keys(rated).length > 1 ? 's' : ''} — recommendations will reflect them right away.`
                : "You're all set — recommendations will sharpen as you rate more."}
            </p>
            <button className="btn-primary" type="button" onClick={() => onFinish(createdProfile)}>Start watching →</button>
          </>
        )}
      </div>
    </div>
  );
}
