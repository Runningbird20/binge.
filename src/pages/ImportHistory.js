import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle, FileArrowUp, UploadSimple, WarningCircle } from '@phosphor-icons/react';
import Navbar from '../components/Navbar';
import { applyImport, matchRecords, parseImport, readImportFiles } from '../utils/historyImport';

const HOW_TO = [
  { name: 'Letterboxd', steps: 'Settings → Import & Export → Export your data. Upload the .zip as-is.' },
  { name: 'IMDb', steps: 'Your Ratings (and Watchlist) → ⋯ menu → Export. Upload the .csv files.' },
  { name: 'Trakt', steps: 'Settings → Data → Export your data. Upload the .zip or the .json files.' },
  { name: 'Netflix', steps: 'Account → your profile → Viewing activity → Download all. Upload the .csv.' },
];

function summarize(records) {
  const count = (list) => records.filter((record) => record.list === list).length;
  return [
    count('rated') && `${count('rated')} rated`,
    count('watched') && `${count('watched')} watched`,
    count('watching') && `${count('watching')} in progress`,
    count('watchlist') && `${count('watchlist')} on a watchlist`,
  ].filter(Boolean).join(' · ');
}

// Bring your history from Letterboxd, IMDb, Trakt or Netflix. Files are
// read in the browser; only the matched titles are saved to your profile.
export default function ImportHistory() {
  const inputRef = useRef(null);
  const [step, setStep] = useState('pick'); // pick | parsed | matching | review | saving | done
  const [parsed, setParsed] = useState(null);
  const [match, setMatch] = useState(null);
  const [progress, setProgress] = useState(null);
  const [overwrite, setOverwrite] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);

  async function onFiles(fileList) {
    setError('');
    try {
      const files = await readImportFiles(fileList);
      const next = parseImport(files);
      if (!next.records.length) {
        setError('Couldn’t find any history in those files. Check the export steps below and upload the .zip, .csv or .json it gives you.');
        return;
      }
      setParsed(next);
      setStep('parsed');
    } catch (err) {
      setError(`Couldn’t read that file: ${err.message}`);
    }
  }

  async function runMatch() {
    setStep('matching');
    setProgress({ done: 0, total: parsed.records.length });
    const next = await matchRecords(parsed.records, setProgress);
    setMatch(next);
    setStep('review');
  }

  async function runImport() {
    setStep('saving');
    setProgress({ done: 0, total: match.matched.length });
    try {
      setResult(await applyImport(match.matched, { overwriteRatings: overwrite }, setProgress));
      setStep('done');
    } catch (err) {
      setError(err.message);
      setStep('review');
    }
  }

  const percent = progress?.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content imp-page" id="main">
        <header className="st-page-head">
          <div>
            <h1 className="st-page-title">Import from other apps</h1>
          </div>
        </header>
        <p className="imp-lede">Your ratings and watch history from Letterboxd, IMDb, Trakt or Netflix make your picks good from day one. Files are read in your browser — only the titles that match binge. are saved.</p>

        {error && <p className="imp-error" role="alert"><WarningCircle size={18} weight="fill" aria-hidden="true" /> {error}</p>}

        {step === 'pick' && (
          <>
            <div
              className={`imp-drop${dragging ? ' over' : ''}`}
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => { event.preventDefault(); setDragging(false); onFiles(event.dataTransfer.files); }}
            >
              <FileArrowUp size={40} weight="duotone" aria-hidden="true" />
              <p>Drop your export here (.zip, .csv or .json — several at once is fine)</p>
              <button type="button" className="st-btn st-btn--primary" onClick={() => inputRef.current?.click()}>
                <UploadSimple size={18} weight="bold" aria-hidden="true" /> Choose files
              </button>
              <input
                ref={inputRef}
                type="file"
                accept=".zip,.csv,.json"
                multiple
                className="sr-only"
                aria-label="Choose export files"
                onChange={(event) => onFiles(event.target.files)}
              />
            </div>
            <section className="imp-how" aria-labelledby="imp-how-title">
              <h2 id="imp-how-title">How to get your export</h2>
              <dl>
                {HOW_TO.map((entry) => (
                  <div key={entry.name}><dt>{entry.name}</dt><dd>{entry.steps}</dd></div>
                ))}
              </dl>
            </section>
          </>
        )}

        {step === 'parsed' && (
          <section className="imp-card" aria-live="polite">
            <h2>Found {parsed.records.length.toLocaleString()} titles from {parsed.sources.join(' & ')}</h2>
            <p className="imp-muted">{summarize(parsed.records)}</p>
            <div className="imp-actions">
              <button type="button" className="st-btn st-btn--primary" onClick={runMatch}>Find them on binge.</button>
              <button type="button" className="st-btn st-btn--ghost" onClick={() => { setParsed(null); setStep('pick'); }}>Choose different files</button>
            </div>
          </section>
        )}

        {(step === 'matching' || step === 'saving') && (
          <section className="imp-card" aria-live="polite" aria-busy="true">
            <h2>{step === 'matching' ? 'Matching titles…' : 'Saving to your profile…'}</h2>
            <div className="imp-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={step === 'matching' ? 'Matching progress' : 'Saving progress'}>
              <span style={{ width: `${percent}%` }} />
            </div>
            <p className="imp-muted">{progress?.done?.toLocaleString()} of {progress?.total?.toLocaleString()}</p>
          </section>
        )}

        {step === 'review' && match && (
          <section className="imp-card" aria-live="polite">
            <h2><CheckCircle size={22} weight="fill" className="imp-ok" aria-hidden="true" /> {match.matched.length.toLocaleString()} titles ready to import</h2>
            <p className="imp-muted">{summarize(match.matched.map((entry) => entry.record))}</p>
            {match.unmatched.length > 0 && (
              <details className="imp-unmatched">
                <summary>{match.unmatched.length.toLocaleString()} not on binge. (skipped)</summary>
                <ul>{match.unmatched.slice(0, 200).map((record, index) => <li key={`${record.title}-${index}`}>{record.title}{record.year ? ` (${record.year})` : ''}</li>)}</ul>
              </details>
            )}
            <label className="imp-check">
              <input type="checkbox" checked={overwrite} onChange={(event) => setOverwrite(event.target.checked)} />
              Replace ratings I already made on binge. with the imported ones
            </label>
            <div className="imp-actions">
              <button type="button" className="st-btn st-btn--primary" onClick={runImport} disabled={!match.matched.length}>Import {match.matched.length.toLocaleString()} titles</button>
              <button type="button" className="st-btn st-btn--ghost" onClick={() => { setMatch(null); setParsed(null); setStep('pick'); }}>Start over</button>
            </div>
          </section>
        )}

        {step === 'done' && result && (
          <section className="imp-card" aria-live="polite">
            <h2><CheckCircle size={22} weight="fill" className="imp-ok" aria-hidden="true" /> Imported!</h2>
            <p>{result.rated.toLocaleString()} ratings and {result.listed.toLocaleString()} titles added to My List{result.skipped ? ` · ${result.skipped} kept your existing binge. rating` : ''}.</p>
            <p className="imp-muted">Your For You rows now learn from all of it.</p>
            <div className="imp-actions">
              <Link to="/home" className="st-btn st-btn--primary">See my picks</Link>
              <Link to="/profile" className="st-btn st-btn--ghost">View profile</Link>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
