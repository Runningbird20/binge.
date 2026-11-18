import { useRef } from 'react';
import { Check } from '@phosphor-icons/react';
import AskDialog from '../AskDialog';
import ProfileAvatar from '../ProfileAvatar';
import LoadingBar from '../LoadingBar';

const NOUN = { movie: 'movie', tv_show: 'series' };

// Asked by Surprise me when the account has other profiles: "Just you?", or
// pick who's watching with you (any of the others), for something you'd all
// like that none of you has seen (personalization.js buildGroupPicks).
// SurpriseButtons keeps `chosen` between surprises, so the same group is one
// tap the next time. While the picks load (`busy`) the buttons wait. The
// picks keep to the youngest viewer's rating; `keepsTo` ({ name, label })
// says whose, when it's stricter than yours.
export default function WatchingWith({ mediaType, others, chosen, onChosenChange, onJustMe, onTogether, busy, problem, keepsTo, onDismiss }) {
  const firstRef = useRef(null);
  const together = others.filter((profile) => chosen.includes(profile.id));
  const togetherLabel = together.length === 1 ? `Surprise ${together[0].name} and me` : `Surprise all ${together.length + 1} of us`;
  const toggle = (id) => onChosenChange(chosen.includes(id) ? chosen.filter((other) => other !== id) : [...chosen, id]);

  return (
    <AskDialog labelledBy="ask-who-title" describedBy="ask-who-text" onDismiss={onDismiss} initialFocusRef={firstRef}>
      <h2 id="ask-who-title">Just you?</h2>
      <p id="ask-who-text">Or pick who’s watching with you, and we’ll find a {NOUN[mediaType] || 'title'} you’d all like that none of you has seen.</p>
      <div className="ask-people" role="group" aria-label="Watching with">
        {others.map((profile) => {
          const on = chosen.includes(profile.id);
          return (
            <button key={profile.id} type="button" className={`ask-person${on ? ' on' : ''}`} aria-pressed={on} onClick={() => toggle(profile.id)} disabled={busy}>
              <ProfileAvatar profile={profile} size={28} />
              <span>{profile.name}</span>
              {on && <Check size={14} weight="bold" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      {keepsTo && <p className="ask-note">Picks keep to {keepsTo.name}’s rating ({keepsTo.label}).</p>}
      {problem && <p className="ask-error" role="alert">{problem}</p>}
      <div className="ask-actions">
        {together.length > 0 && (
          <button type="button" className="st-btn st-btn--primary" ref={firstRef} onClick={onTogether} disabled={busy}>{togetherLabel}</button>
        )}
        <button
          type="button"
          className={`st-btn ${together.length ? 'st-btn--ghost' : 'st-btn--primary'}`}
          ref={together.length ? undefined : firstRef}
          onClick={onJustMe}
          disabled={busy}
        >
          Just me
        </button>
      </div>
      {busy && <LoadingBar compact label="Finding something you’d all like…" />}
    </AskDialog>
  );
}
