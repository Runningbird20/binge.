import { useEffect, useRef, useState } from 'react';
import BottomSheet from './BottomSheet';
import { haptic } from '../utils/haptics';
import { CaretDown, Check, CheckCircle, HardDrives, SpeakerHigh, Subtitles, Warning, WarningCircle } from '@phosphor-icons/react';
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
  onReportAudio,
  blockedCount = 0,
  health = {},
  onClose,
}) {
  const originalName = languageName(originalLanguage);
  const current = servers.find((server) => server.id === currentServer);
  const downNames = servers.filter((server) => health[server.id]?.down).map((server) => serverLabels[server.id]?.label || server.id);

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
        {downNames.length > 0 && (
          <p className="st-pb-outage" role="status">
            <Warning size={14} weight="fill" aria-hidden="true" />
            {downNames.join(', ')} {downNames.length === 1 ? 'seems' : 'seem'} to be down for many viewers today, so {downNames.length === 1 ? 'it’s' : 'they’re'} tried last.
          </p>
        )}
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
                    {server.note && (
                      <span className={`st-pb-server-note st-pb-server-note--${server.status || 'unknown'}`}>
                        {server.status === 'good' && <CheckCircle size={13} weight="fill" aria-hidden="true" />}
                        {(server.status === 'down' || server.status === 'bad') && <Warning size={13} weight="fill" aria-hidden="true" />}
                        {server.note}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {onReportAudio && (
          <label className="st-pb-report">
            <span>Audio on this server</span>
            <select
              value={current?.audio || ''}
              onChange={(event) => onReportAudio(event.target.value)}
              aria-label="Report the audio language on the current server"
            >
              <option value="" disabled>Tell us…</option>
              {['en', 'ko', 'ja', 'es', 'fr', 'hi', 'zh', 'de', 'it', 'pt'].map((code) => (
                <option key={code} value={code}>{languageName(code)}</option>
              ))}
            </select>
          </label>
        )}
        {blockedCount > 0 && (
          <p className="st-pb-hint">{blockedCount} server{blockedCount === 1 ? ' is' : 's are'} blocked on the network you’re on and hidden.</p>
        )}
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

// Phones: three compact buttons under the video, each opening a bottom
// sheet at thumb height, instead of one long inline panel.
export function MobilePlaybackPickers({
  prefs, onPrefsChange, originalLanguage, servers, currentServer, serverLabels,
  onSelectServer, onReportBroken, blockedCount = 0, health = {},
}) {
  const [sheet, setSheet] = useState(null); // 'server' | 'audio' | 'subs'
  const originalName = languageName(originalLanguage);
  const current = servers.find((server) => server.id === currentServer);
  const audioChoice = AUDIO_CHOICES.find((choice) => choice.value === prefs.audio);
  const subChoice = SUBTITLE_CHOICES.find((choice) => choice.value === prefs.subtitles);
  const downNames = servers.filter((server) => health[server.id]?.down).map((server) => serverLabels[server.id]?.label || server.id);
  const close = () => setSheet(null);
  const pick = (fn) => (value) => { haptic(); fn(value); close(); };

  return (
    <>
      <div className="mp-pickers">
        <button type="button" className="mp-picker" onClick={() => setSheet('server')}>
          <HardDrives size={16} weight="bold" aria-hidden="true" />
          <span className="mp-picker-text"><span className="mp-picker-label">Server</span>{serverLabels[currentServer]?.label || currentServer}</span>
          {current?.status === 'good' && <CheckCircle size={14} weight="fill" className="mp-picker-ok" aria-label="works for this title" />}
          <CaretDown size={14} weight="bold" aria-hidden="true" />
        </button>
        <button type="button" className="mp-picker" onClick={() => setSheet('audio')}>
          <SpeakerHigh size={16} weight="bold" aria-hidden="true" />
          <span className="mp-picker-text"><span className="mp-picker-label">Audio</span>{prefs.audio === 'original' && originalName ? originalName : audioChoice?.label}</span>
          <CaretDown size={14} weight="bold" aria-hidden="true" />
        </button>
        <button type="button" className="mp-picker" onClick={() => setSheet('subs')}>
          <Subtitles size={16} weight="bold" aria-hidden="true" />
          <span className="mp-picker-text"><span className="mp-picker-label">Subtitles</span>{subChoice?.label}</span>
          <CaretDown size={14} weight="bold" aria-hidden="true" />
        </button>
      </div>

      <BottomSheet open={sheet === 'server'} onClose={close} title="Server">
        {downNames.length > 0 && (
          <p className="st-pb-outage"><Warning size={14} weight="fill" aria-hidden="true" /> {downNames.join(', ')} {downNames.length === 1 ? 'seems' : 'seem'} to be down for many viewers today.</p>
        )}
        {servers.map((server, index) => {
          const meta = serverLabels[server.id] || {};
          const active = server.id === currentServer;
          return (
            <button key={server.id} type="button" className={`bsheet-option${active ? ' active' : ''}`} onClick={() => pick(onSelectServer)(server.id)}>
              <span className="mp-sheet-server">
                <span>{meta.label || server.id}{index === 0 && <span className="st-pb-tag st-pb-tag--best">Best match</span>}{meta.subtitles && <span className="st-pb-tag">CC</span>}</span>
                {server.note && <span className={`st-pb-server-note st-pb-server-note--${server.status || 'unknown'}`}>{server.note}</span>}
              </span>
              {active && <Check size={18} weight="bold" className="bsheet-option-check" />}
            </button>
          );
        })}
        {blockedCount > 0 && <p className="st-pb-hint">{blockedCount} server{blockedCount === 1 ? ' is' : 's are'} blocked on this network and hidden.</p>}
        <button type="button" className="st-btn st-btn--ghost mp-sheet-broken" onClick={() => { onReportBroken(); close(); }}>
          <WarningCircle size={16} weight="bold" /> Not playing? Try the next server
        </button>
      </BottomSheet>

      <BottomSheet open={sheet === 'audio'} onClose={close} title="Audio language">
        {AUDIO_CHOICES.map((choice) => {
          const active = prefs.audio === choice.value;
          const label = choice.value === 'original' && originalName ? `Original (${originalName})` : choice.label;
          return (
            <button key={choice.value} type="button" className={`bsheet-option${active ? ' active' : ''}`} onClick={() => pick((audio) => onPrefsChange({ audio }))(choice.value)}>
              {label}{active && <Check size={18} weight="bold" className="bsheet-option-check" />}
            </button>
          );
        })}
      </BottomSheet>

      <BottomSheet open={sheet === 'subs'} onClose={close} title="Subtitles">
        {SUBTITLE_CHOICES.map((choice) => {
          const active = prefs.subtitles === choice.value;
          return (
            <button key={choice.value} type="button" className={`bsheet-option${active ? ' active' : ''}`} onClick={() => pick((subtitles) => onPrefsChange({ subtitles }))(choice.value)}>
              {choice.label}{active && <Check size={18} weight="bold" className="bsheet-option-check" />}
            </button>
          );
        })}
        <p className="st-pb-hint">Applied automatically on servers marked CC. On others, use the player’s own CC button.</p>
      </BottomSheet>
    </>
  );
}
