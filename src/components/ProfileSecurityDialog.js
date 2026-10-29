import { useEffect, useRef, useState } from 'react';
import { X } from '@phosphor-icons/react';
import { requireSupabaseClient } from '../utils/supabase';

const PIN_LENGTH = 4;

// Full-screen "Profile Lock is currently on." screen: four digit boxes that
// advance as you type, step back on Backspace, accept a pasted PIN and
// submit on the last digit.
function ProfileLockScreen({ profile, onCancel, onUnlock }) {
  const [digits, setDigits] = useState(Array(PIN_LENGTH).fill(''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const boxes = useRef([]);
  const focusBox = (i) => boxes.current[Math.max(0, Math.min(PIN_LENGTH - 1, i))]?.focus();

  useEffect(() => { focusBox(0); }, []);
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  async function check(pin) {
    setBusy(true);
    setError('');
    try {
      const { data, error: verifyError } = await requireSupabaseClient()
        .rpc('verify_profile_pin', { target_profile: profile.id, entered_pin: pin });
      if (verifyError) throw verifyError;
      if (data) { onUnlock(); return; }
      setError('Incorrect PIN. After five wrong tries, wait five minutes.');
    } catch (err) {
      setError(err.message || 'Unable to check the PIN. Please try again.');
    }
    setBusy(false);
    setDigits(Array(PIN_LENGTH).fill(''));
    requestAnimationFrame(() => focusBox(0));
  }

  function fill(start, text) {
    const typed = text.replace(/\D/g, '').slice(0, PIN_LENGTH - start).split('');
    if (!typed.length) return;
    const next = [...digits];
    typed.forEach((d, i) => { next[start + i] = d; });
    setDigits(next);
    if (error) setError('');
    if (next.every(Boolean)) check(next.join(''));
    else focusBox(start + typed.length);
  }

  function onKeyDown(event, i) {
    if (event.key === 'Backspace' && !digits[i]) {
      event.preventDefault();
      const next = [...digits];
      next[i - 1 >= 0 ? i - 1 : 0] = '';
      setDigits(next);
      focusBox(i - 1);
    } else if (event.key === 'ArrowLeft') { event.preventDefault(); focusBox(i - 1); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); focusBox(i + 1); }
  }

  return (
    <div className="profile-lock-screen" role="dialog" aria-modal="true" aria-labelledby="profile-lock-title">
      <button type="button" className="profile-lock-close" aria-label="Back to profiles" onClick={onCancel}>
        <X size={28} weight="bold" aria-hidden="true" />
      </button>
      <p className="profile-lock-status">Profile Lock is currently on.</p>
      <h1 id="profile-lock-title" className="profile-lock-title">Enter your pin to access this profile.</h1>
      <div className={`profile-lock-boxes${error ? ' profile-lock-boxes--error' : ''}`} role="group" aria-label={`PIN for ${profile.name}`}>
        {digits.map((digit, i) => (
          <input
            key={i}
            ref={(el) => { boxes.current[i] = el; }}
            className="profile-lock-box"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={1}
            aria-label={`Digit ${i + 1} of ${PIN_LENGTH}`}
            disabled={busy}
            value={digit}
            onChange={(event) => fill(i, event.target.value.slice(-1))}
            onPaste={(event) => { event.preventDefault(); fill(i, event.clipboardData.getData('text')); }}
            onKeyDown={(event) => onKeyDown(event, i)}
            onFocus={(event) => event.target.select()}
          />
        ))}
      </div>
      <p className="profile-lock-error" role="alert">{error}</p>
    </div>
  );
}

// The lock screen shown when picking a locked profile. Editing a profile's
// lock lives on the Edit Profile page (pages/EditProfile.js).
export default function ProfileSecurityDialog({ profile, onCancel, onUnlock }) {
  return <ProfileLockScreen profile={profile} onCancel={onCancel} onUnlock={onUnlock} />;
}
