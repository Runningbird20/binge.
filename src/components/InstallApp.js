import { useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { Check, Copy, DeviceMobile, DownloadSimple, Export, PlusSquare } from '@phosphor-icons/react';
import BottomSheet from './BottomSheet';
import useDeviceType from '../hooks/useDeviceType';
import { APP_DOWNLOADS, promptInstall, useInstallApp } from '../utils/installApp';

// "Install binge.": a button at the top right of the phone header. On Android
// it downloads the app (binge.apk) straight away. On an iPhone it opens a
// sheet with the two ways to have binge. as an app, and what each gets you.
// Only on phones in a browser: not on computers, in a Home Screen install or
// inside the phone apps (utils/installApp.js).
export default function InstallApp() {
  const { isMobile } = useDeviceType();
  const { canPrompt, installed, platform } = useInstallApp();
  const [open, setOpen] = useState(false);
  if (!isMobile || installed) return null;
  const close = () => setOpen(false);

  // Android: one tap downloads the app. GitHub sends the release file as a
  // download, so the page stays where it is; a note says what to do with it.
  if (platform === 'android') {
    return (
      <a
        className="navbar-install"
        href={APP_DOWNLOADS.android}
        onClick={() => toast('Downloading binge.apk', { description: 'Open it when it’s done, and allow installs from your browser if Android asks.' })}
      >
        <DownloadSimple size={16} weight="bold" aria-hidden="true" /> Install
      </a>
    );
  }

  async function addToHomeScreen() {
    if (await promptInstall() === 'accepted') close();
  }

  return (
    <>
      <button type="button" className="navbar-install" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <DownloadSimple size={16} weight="bold" aria-hidden="true" /> Install
      </button>
      {/* On document.body: the phone header's backdrop-filter would otherwise
          pin the sheet's fixed overlay to the header instead of the screen. */}
      {createPortal(
        <BottomSheet open={open} onClose={close} title="Install binge.">
          <div className="install-sheet">
            {platform === 'ios'
              ? <IphoneChoices />
              : <AndroidChoices canPrompt={canPrompt} onAddToHomeScreen={addToHomeScreen} />}
          </div>
        </BottomSheet>,
        document.body,
      )}
    </>
  );
}

function AndroidChoices({ canPrompt, onAddToHomeScreen }) {
  return (
    <>
      <section className="install-choice">
        <h3><PlusSquare size={20} weight="bold" aria-hidden="true" /> Add to Home Screen</h3>
        <p>Opens like an app, and keeps binge. notifications.</p>
        {canPrompt ? (
          <button type="button" className="st-btn st-btn--primary install-action" onClick={onAddToHomeScreen}>Add to Home Screen</button>
        ) : (
          <p className="install-how">In your browser’s menu, tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.</p>
        )}
      </section>
      <section className="install-choice">
        <h3><DeviceMobile size={20} weight="bold" aria-hidden="true" /> The Android app</h3>
        <p>Also blocks the video servers’ pop-ups and redirects. It doesn’t get notifications.</p>
        <a className="st-btn st-btn--ghost install-action" href={APP_DOWNLOADS.android}>Download binge.apk</a>
        <p className="install-how">Open it once it’s downloaded, and allow installing from your browser when Android asks.</p>
      </section>
    </>
  );
}

function IphoneChoices() {
  const [copied, setCopied] = useState(false);
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(APP_DOWNLOADS.ios);
      setCopied(true);
    } catch { /* no clipboard: the link is shown below the button */ }
  }
  return (
    <>
      <section className="install-choice">
        <h3><PlusSquare size={20} weight="bold" aria-hidden="true" /> Add to Home Screen</h3>
        <p>Opens like an app, and it’s how an iPhone gets binge. notifications.</p>
        <ol className="install-steps">
          <li>Tap <Export size={18} weight="bold" aria-label="Share" className="install-inline-icon" /> <strong>Share</strong> in Safari’s toolbar.</li>
          <li>Choose <strong>Add to Home Screen</strong>.</li>
        </ol>
      </section>
      <section className="install-choice">
        <h3><DeviceMobile size={20} weight="bold" aria-hidden="true" /> The iPhone app</h3>
        <p>Also blocks the video servers’ pop-ups and redirects, but it needs a computer: download binge.ipa there and install it with Sideloadly or AltStore. With a free Apple ID it has to be reinstalled every 7 days.</p>
        <button type="button" className="st-btn st-btn--ghost install-action" onClick={copyLink}>
          {copied
            ? <><Check size={18} weight="bold" aria-hidden="true" /> Link copied</>
            : <><Copy size={18} weight="bold" aria-hidden="true" /> Copy the download link</>}
        </button>
        <p className="install-how install-url">{APP_DOWNLOADS.ios}</p>
      </section>
    </>
  );
}
