import { useState } from 'react';
import ThemedSelect from './ThemedSelect';
import { submitSupabaseRequest } from '../utils/supabaseData';

export default function RequestModal({ prefill, onClose }) {
  const [title, setTitle]         = useState(prefill?.title || '');
  const [mediaType, setMediaType] = useState(prefill?.media_type || 'movie');
  const [year, setYear]           = useState('');
  const [reason, setReason]       = useState('');
  const [status, setStatus]       = useState(null);
  const [error, setError]         = useState('');

  async function submit() {
    if (!title.trim()) { setError('Please enter a title.'); return; }
    setStatus('loading');
    setError('');
    try {
      await submitSupabaseRequest({ title: title.trim(), media_type: mediaType, year: year || undefined, reason });
      setStatus('success');
    } catch (err) {
      const message = String(err?.message || '').trim();
      setError(message || 'Something went wrong.');
      setStatus(null);
    }
  }

  return (
    <div className="req-overlay" onClick={onClose}>
      <div className="req-modal" onClick={e => e.stopPropagation()}>
        {status === 'success' ? (
          <div className="req-success">
            <div className="req-success-icon">✨</div>
            <h3>Request submitted!</h3>
            <p>An admin will review your request for <em>"{title}"</em>.</p>
            <button className="btn-primary" onClick={onClose}>Done</button>
          </div>
        ) : (
          <>
            <div className="req-header">
              <div>
                <p className="req-eyebrow">Can't find it?</p>
                <h3 className="req-title">Request Media</h3>
              </div>
              <button className="req-close" onClick={onClose}>✕</button>
            </div>
            <p className="req-subtitle">Ask an admin to add something to binge.</p>

            {error && <div className="req-error">{error}</div>}

            <div className="req-form">
              <div className="req-field">
                <label>Title</label>
                <input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="e.g. Interstellar"
                  onKeyDown={e => e.key === 'Enter' && submit()}
                  autoFocus
                />
              </div>

              <div className="req-field-row">
                <div className="req-field">
                  <label>Type</label>
                  <ThemedSelect
                    label="Type"
                    value={mediaType}
                    options={[
                      { value: 'movie', label: 'Movie' },
                      { value: 'tv_show', label: 'TV Show' },
                      { value: 'book', label: 'Book' },
                    ]}
                    onChange={e => setMediaType(e.target.value)}
                  />
                </div>
                <div className="req-field">
                  <label>Year <span className="req-optional">(optional)</span></label>
                  <input
                    type="number"
                    value={year}
                    onChange={e => setYear(e.target.value)}
                    placeholder="e.g. 2014"
                    min="1888" max="2030"
                  />
                </div>
              </div>

              <div className="req-field">
                <label>Why do you want it? <span className="req-optional">(optional)</span></label>
                <textarea
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="e.g. It's a classic everyone should see"
                  rows={2}
                />
              </div>

              <button
                className="req-submit"
                onClick={submit}
                disabled={status === 'loading'}
              >
                {status === 'loading' ? 'Submitting...' : 'Submit Request →'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
