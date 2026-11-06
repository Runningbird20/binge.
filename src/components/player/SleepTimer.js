import { useEffect, useRef, useState } from 'react';
import { Check, MoonStars } from '@phosphor-icons/react';

// The sleep timer's controls (useSleepTimer). Computer: a pill in the player's
// bar with a short menu. Phone: a row of chips under the video.

export function SleepTimerMenu({ sleep }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event) {
      if (!wrapRef.current?.contains(event.target)) setOpen(false);
    }
    // Escape closes the menu, not the player (capture, before usePlayerKeyboard).
    function onKey(event) {
      if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); }
    }
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div className="player-sleep" ref={wrapRef}>
      <button
        type="button"
        className={`player-pill${sleep.label ? ' player-pill--on' : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <MoonStars size={16} weight="bold" aria-hidden="true" /> {sleep.label || 'Sleep timer'}
      </button>
      {open && (
        <div className="player-sleep-menu" role="group" aria-label="Sleep timer">
          {sleep.options.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`player-sleep-option${sleep.choice === option.id ? ' active' : ''}`}
              aria-pressed={sleep.choice === option.id}
              onClick={() => { sleep.choose(option.id); setOpen(false); }}
            >
              <span className="player-sleep-check">{sleep.choice === option.id && <Check size={16} weight="bold" aria-hidden="true" />}</span>
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SleepTimerRow({ sleep }) {
  return (
    <div className="mp-row">
      <span className="mp-row-label">Sleep timer{sleep.label ? ` · ${sleep.label.toLowerCase()}` : ''}</span>
      <div className="mp-chips" role="group" aria-label="Sleep timer">
        {sleep.options.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`mp-chip${sleep.choice === option.id ? ' active' : ''}`}
            aria-pressed={sleep.choice === option.id}
            onClick={() => sleep.choose(option.id)}
          >{option.label}</button>
        ))}
      </div>
    </div>
  );
}
