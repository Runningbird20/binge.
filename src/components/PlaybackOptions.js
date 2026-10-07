import { useEffect, useRef, useState } from 'react';
import { Check, Subtitles, WarningCircle } from '@phosphor-icons/react';
import { AUDIO_CHOICES, SUBTITLE_CHOICES } from '../utils/streamPreferences';
import { languageName } from '../utils/tmdb';

// Netflix-style "Audio & Subtitles" panel for the embed player: pick audio
// and subtitle language without leaving the video, and see every server
// ranked for those choices (with why it's recommended).
export function PlaybackOptionsPanel({
  prefs,
  onPrefsChange,
  originalLanguage,
  servers,
  currentServer,
  serverLabels,
  onSelectServer,
  onReportBroken,
  onClose,
}) {
  const originalName = languageName(originalLanguage);

  return (
    <div className="st-pb-panel" role="dialog" aria-label="Audio, subtitles and server">
      <div className="st-pb-col">
        <h3>Audio</h3>
        <ul role="radiogroup" aria-label="Audio language">
          {AUDIO_CHOICES.map((choice) => {
            const active = prefs.audio === choice.value;
            const label = choice.value === 'original' && originalName ? `Original (${originalName})` : choice.label;
            return (
              <li key={choice.value}>
                <button type="button" role="radio" aria-checked={active} className={active ? 'active' : ''} onClick={() => onPrefsChange({ audio: choice.value })}>
                  <span className="st-pb-check">{active && <Check size={14} weight="bold" />}</span>{label}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="st-pb-col">
        <h3>Subtitles</h3>
        <ul role="radiogroup" aria-label="Subtitle language">
          {SUBTITLE_CHOICES.map((choice) => {
            const active = prefs.subtitles === choice.value;
            return (
              <li key={choice.value}>
                <button type="button" role="radio" aria-checked={active} className={active ? 'active' : ''} onClick={() => onPrefsChange({ subtitles: choice.value })}>
                  <span className="st-pb-check">{active && <Check size={14} weight="bold" />}</span>{choice.label}
                </button>
              </li>
            );
          })}
        </ul>
        <p className="st-pb-hint">Applied automatically on servers that support it (marked CC). On others, use the player's own CC button.</p>
      </div>

      <div className="st-pb-col st-pb-col--wide">
        <h3>Server</h3>
        <ul role="radiogroup" aria-label="Server">
          {servers.map((server, index) => {
            const active = server.id === currentServer;
            const meta = serverLabels[server.id] || {};
            return (
              <li key={server.id}>
                <button type="button" role="radio" aria-checked={active} className={active ? 'active' : ''} onClick={() => onSelectServer(server.id)}>
                  <span className="st-pb-check">{active && <Check size={14} weight="bold" />}</span>
                  <span className="st-pb-server">
                    <span className="st-pb-server-name">
                      {meta.label || server.id}
                      {index === 0 && <span className="st-pb-tag st-pb-tag--best">Best match</span>}
                      {server.audio && <span className="st-pb-tag">{languageName(server.audio)} audio</span>}
                      {meta.subtitles && <span className="st-pb-tag">CC</span>}
                    </span>
                    {server.note && <span className="st-pb-server-note">{server.note}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <button type="button" className="st-btn st-btn--ghost st-pb-broken" onClick={onReportBroken}>
          <WarningCircle size={16} weight="bold" /> Not playing? Try the next server
        </button>
      </div>

      {onClose && (
        <button type="button" className="st-btn st-btn--secondary st-pb-done" onClick={onClose}>Done</button>
      )}
    </div>
  );
}

// Trigger button + popover, with outside-click / Escape to close.
export default function PlaybackOptions(props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event) {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    }
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
    <div className="st-pb" ref={wrapRef}>
      <button
        type="button"
        className="st-pb-trigger"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Subtitles size={18} weight="bold" /> Audio &amp; Subtitles
      </button>
      {open && <PlaybackOptionsPanel {...props} onClose={() => setOpen(false)} />}
    </div>
  );
}

// One-tap check that teaches the ranking: "Hearing Korean?" Yes / No.
export function AudioCheckPrompt({ language, onAnswer }) {
  const name = languageName(language);
  const [step, setStep] = useState('ask');
  if (!language) return null;

  if (step === 'which') {
    return (
      <div className="st-pb-ask" role="group" aria-label="Which audio language is playing?">
        <span>What are you hearing?</span>
        {['en', 'es', 'fr', 'hi', 'ja', 'ko'].filter((code) => code !== language).slice(0, 4).map((code) => (
          <button key={code} type="button" onClick={() => onAnswer(false, code)}>{languageName(code)}</button>
        ))}
        <button type="button" onClick={() => onAnswer(false, null)}>Other</button>
      </div>
    );
  }

  return (
    <div className="st-pb-ask" role="group" aria-label={`Is the audio in ${name}?`}>
      <span>Hearing {name} audio?</span>
      <button type="button" onClick={() => onAnswer(true, language)}>Yes</button>
      <button type="button" onClick={() => setStep('which')}>No — find another server</button>
      <button type="button" className="st-pb-ask-dismiss" onClick={() => onAnswer(null, null)} aria-label="Dismiss">✕</button>
    </div>
  );
}
