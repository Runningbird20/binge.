import { useState } from 'react';
import { DownloadSimple } from '@phosphor-icons/react';
import { downloadMyData } from '../utils/dataExport';

// "Download my data" on the Profile page (bottom right of the hero): the
// active profile's ratings, My List, history and episode progress as a .zip
// (JSON + Letterboxd-style CSVs; see utils/dataExport.js).
export default function DownloadDataButton({ profileName }) {
  const [state, setState] = useState('idle'); // idle | working | done | error
  const [message, setMessage] = useState('');

  async function handleClick() {
    setState('working');
    setMessage('');
    try {
      const { summary } = await downloadMyData({ profileName });
      setState('done');
      setMessage(`Downloaded ${summary}.`);
    } catch (error) {
      setState('error');
      setMessage(error?.message || 'Couldn’t prepare your data. Try again in a moment.');
    }
  }

  return (
    <div className="pf-download">
      <button
        type="button"
        className="genre-chip pf-action-link"
        onClick={handleClick}
        disabled={state === 'working'}
        aria-describedby={message ? 'pf-download-note' : undefined}
      >
        <DownloadSimple size={16} weight="bold" />
        {state === 'working' ? 'Preparing your data…' : 'Download my data'}
      </button>
      {message && (
        <p id="pf-download-note" className={`pf-download-note${state === 'error' ? ' is-error' : ''}`} role={state === 'error' ? 'alert' : 'status'}>
          {message}
        </p>
      )}
    </div>
  );
}
