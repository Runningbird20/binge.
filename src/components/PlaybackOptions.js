import ThemedSelect from './ThemedSelect';
import { useEffect, useRef, useState } from 'react';
import BottomSheet from './BottomSheet';
import { haptic } from '../utils/haptics';
import { CaretDown, Check, CheckCircle, HardDrives, ShieldCheck, Warning, WarningCircle } from '@phosphor-icons/react';
import { languageName } from '../utils/tmdb';
import { popupsBlocked } from '../utils/popupSandbox';

// Servers whose pop-ups and redirects are blocked (utils/popupSandbox.js).
// The one playing uses what actually happened on this load (popupsBlockedNow):
// it may have been reloaded unsandboxed after refusing the sandbox.
function popupFreeCheck(currentServer, popupsBlockedNow) {
  return (id) => (id === currentServer && typeof popupsBlockedNow === 'boolean' ? popupsBlockedNow : popupsBlocked(id));
}

export function NoPopupsTag() {
  return (
    <span className="st-pb-tag st-pb-tag--safe">
      <ShieldCheck size={11} weight="fill" aria-hidden="true" /> No pop-ups
    </span>
  );
}

const NO_POPUPS_HINT = 'Servers marked No pop-ups play with their pop-ups and redirects blocked. The others won’t play that way.';

// The player's "Servers" panel: every server ranked for this title (with why
// it's recommended), switchable without leaving the video. Audio and subtitle
// languages are set in Settings; the ranking still follows them.
export function PlaybackOptionsPanel({
  servers,
  currentServer,
  serverLabels,
  onSelectServer,
  onReportBroken,
  onReportAudio,
  blockedCount = 0,
  health = {},
  popupsBlockedNow,
  appCaptions,
  onClose,
}) {
  const current = servers.find((server) => server.id === currentServer);
  const downNames = servers.filter((server) => health[server.id]?.down).map((server) => serverLabels[server.id]?.label || server.id);
  const noPopups = popupFreeCheck(currentServer, popupsBlockedNow);

  return (
    <div className="st-pb-panel" role="dialog" aria-label="Servers">
      <div className="st-pb-col">
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
                      {noPopups(server.id) && <NoPopupsTag />}
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
        {servers.some((server) => noPopups(server.id)) && <p className="st-pb-hint">{NO_POPUPS_HINT}</p>}
        {onReportAudio && (
          <label className="st-pb-report">
            <span>Audio on this server</span>
            <ThemedSelect
              value={current?.audio || ''}
              onChange={(event) => onReportAudio(event.target.value)}
              aria-label="Report the audio language on the current server"
              options={[{ value: '', label: 'Tell us…', disabled: true }, ...['en', 'ko', 'ja', 'es', 'fr', 'hi', 'zh', 'de', 'it', 'pt'].map((code) => ({ value: code, label: languageName(code) }))]}
            />
          </label>
        )}
        {blockedCount > 0 && (
          <p className="st-pb-hint">{blockedCount} server{blockedCount === 1 ? ' is' : 's are'} blocked on the network you’re on and hidden.</p>
        )}
        <button type="button" className="st-btn st-btn--ghost st-pb-broken" onClick={onReportBroken}>
          <WarningCircle size={16} weight="bold" /> Not playing? Try the next server
        </button>
      </div>

      {appCaptions && (
        <div className="st-pb-col">
          <h3>binge. captions</h3>
          <ul role="radiogroup" aria-label="binge. captions">
            {[[true, 'On'], [false, 'Off']].map(([value, label]) => (
              <li key={label}>
                <button type="button" role="radio" aria-checked={appCaptions.on === value} className={appCaptions.on === value ? 'active' : ''} onClick={() => { if (appCaptions.on !== value) appCaptions.toggle(); }}>
                  <span className="st-pb-check">{appCaptions.on === value && <Check size={14} weight="bold" />}</span>{label}
                </button>
              </li>
            ))}
          </ul>
          {appCaptions.on && (
            <>
              <p className="st-pb-hint">
                {!appCaptions.loaded ? 'Finding captions…'
                  : appCaptions.shift === 0 ? 'Timing: as the file has them.'
                  : `Lines show ${Math.abs(appCaptions.shift).toFixed(1)}s ${appCaptions.shift > 0 ? 'later' : 'earlier'}.`}
              </p>
              <div className="st-pb-timing">
                <button type="button" className="st-btn st-btn--ghost" onClick={() => appCaptions.nudge(-0.5)} disabled={!appCaptions.loaded}>Earlier (0.5s)</button>
                <button type="button" className="st-btn st-btn--ghost" onClick={() => appCaptions.nudge(0.5)} disabled={!appCaptions.loaded}>Later (0.5s)</button>
                {appCaptions.shift !== 0 && <button type="button" className="st-btn st-btn--ghost" onClick={appCaptions.reset}>Reset</button>}
                {appCaptions.nextVersion && <button type="button" className="st-btn st-btn--ghost" onClick={appCaptions.nextVersion}>Another version</button>}
              </div>
              <p className="st-pb-hint">Drawn by binge. inside the video, in your subtitle language. A timing fix is remembered and shared, so other viewers start in sync. Turn the server's own captions off if both show.</p>
            </>
          )}
        </div>
      )}

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
        className="player-pill st-pb-trigger"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <HardDrives size={18} weight="bold" aria-hidden="true" /> Servers
      </button>
      {open && <PlaybackOptionsPanel {...props} onClose={() => setOpen(false)} />}
    </div>
  );
}

// Phones: a compact Server button under the video, opening a bottom sheet
// at thumb height, instead of an inline panel.
export function MobilePlaybackPickers({
  servers, currentServer, serverLabels, onSelectServer, onReportBroken,
  blockedCount = 0, health = {}, popupsBlockedNow,
}) {
  const [open, setOpen] = useState(false);
  const current = servers.find((server) => server.id === currentServer);
  const downNames = servers.filter((server) => health[server.id]?.down).map((server) => serverLabels[server.id]?.label || server.id);
  const close = () => setOpen(false);
  const noPopups = popupFreeCheck(currentServer, popupsBlockedNow);

  return (
    <>
      <div className="mp-pickers">
        <button type="button" className="mp-picker" onClick={() => setOpen(true)}>
          <HardDrives size={16} weight="bold" aria-hidden="true" />
          <span className="mp-picker-text"><span className="mp-picker-label">Server</span>{serverLabels[currentServer]?.label || currentServer}</span>
          {current?.status === 'good' && <CheckCircle size={14} weight="fill" className="mp-picker-ok" aria-label="works for this title" />}
          <CaretDown size={14} weight="bold" aria-hidden="true" />
        </button>
      </div>

      <BottomSheet open={open} onClose={close} title="Server">
        {downNames.length > 0 && (
          <p className="st-pb-outage"><Warning size={14} weight="fill" aria-hidden="true" /> {downNames.join(', ')} {downNames.length === 1 ? 'seems' : 'seem'} to be down for many viewers today.</p>
        )}
        {servers.map((server, index) => {
          const meta = serverLabels[server.id] || {};
          const active = server.id === currentServer;
          return (
            <button key={server.id} type="button" className={`bsheet-option${active ? ' active' : ''}`} onClick={() => { haptic(); onSelectServer(server.id); close(); }}>
              <span className="mp-sheet-server">
                <span>{meta.label || server.id}{index === 0 && <span className="st-pb-tag st-pb-tag--best">Best match</span>}{meta.subtitles && <span className="st-pb-tag">CC</span>}{noPopups(server.id) && <NoPopupsTag />}</span>
                {server.note && <span className={`st-pb-server-note st-pb-server-note--${server.status || 'unknown'}`}>{server.note}</span>}
              </span>
              {active && <Check size={18} weight="bold" className="bsheet-option-check" />}
            </button>
          );
        })}
        {servers.some((server) => noPopups(server.id)) && <p className="st-pb-hint">{NO_POPUPS_HINT}</p>}
        {blockedCount > 0 && <p className="st-pb-hint">{blockedCount} server{blockedCount === 1 ? ' is' : 's are'} blocked on this network and hidden.</p>}
        <button type="button" className="st-btn st-btn--ghost mp-sheet-broken" onClick={() => { onReportBroken(); close(); }}>
          <WarningCircle size={16} weight="bold" /> Not playing? Try the next server
        </button>
      </BottomSheet>
    </>
  );
}
