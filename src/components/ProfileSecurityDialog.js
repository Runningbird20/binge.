import ThemedSelect from './ThemedSelect';
import { useEffect, useRef, useState } from 'react';
import { X } from '@phosphor-icons/react';
import { requireSupabaseClient } from '../utils/supabase';
import { signInWithSupabase, updateAccountProfile } from '../utils/supabaseData';

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

export default function ProfileSecurityDialog(props) {
  if (!props.editing) return <ProfileLockScreen profile={props.profile} onCancel={props.onCancel} onUnlock={props.onUnlock} />;
  return <ProfileSettingsDialog {...props} />;
}

function ProfileSettingsDialog({ profile, email, locked, locksAvailable = true, onCancel, onSaved }) {
  const [isKids, setIsKids] = useState(Boolean(profile.is_kids));
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [remove, setRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault();
    setError('');
    if (pin && !/^[0-9]{4}$/.test(pin)) return setError('Enter exactly four digits.');
    if (pin && !remove && pin !== confirm) return setError('PINs do not match.');
    setBusy(true);
    try {
      const client = requireSupabaseClient();
      await signInWithSupabase({ email, password });
      if (pin || remove) {
        const { error: lockError } = await client.rpc('set_profile_lock', { target_profile: profile.id, new_pin: remove ? null : pin });
        if (lockError) throw lockError;
      }
      await updateAccountProfile(profile.id, { isKids });
      await onSaved();
    } catch (err) { setError(err.message || 'Unable to save profile.'); }
    finally { setBusy(false); }
  }
  return (
    <div className="profile-delete-overlay">
      <form className="profile-delete-card profile-security-card" role="dialog" aria-modal="true" aria-labelledby="profile-security-title" onSubmit={submit}>
        <h3 id="profile-security-title">Edit {profile.name}</h3>
        <>
          <label>Age rating<ThemedSelect aria-label="Age rating" value={isKids ? 'kids' : 'all'} onChange={(e) => setIsKids(e.target.value === 'kids')} options={[{ value: 'all', label: 'All ratings' }, { value: 'kids', label: 'Kids — G, PG, TV-Y, TV-Y7, TV-G, TV-PG' }]} /></label>
          <label>Account password<input className="profile-picker-add-input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <p>Confirm your account password to change age restrictions or the profile lock.</p>
        </>
        {locksAvailable && !remove && <label>{locked ? 'New four-digit PIN (leave blank to keep)' : 'Four-digit PIN (optional)'}
          <input className="profile-picker-add-input" type="password" inputMode="numeric" autoComplete="off" maxLength={4} pattern="[0-9]{4}" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
        </label>}
        {locksAvailable && pin && !remove && <label>Confirm PIN<input className="profile-picker-add-input" type="password" inputMode="numeric" maxLength={4} required value={confirm} onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ''))} /></label>}
        {locksAvailable && locked && <label><input type="checkbox" checked={remove} onChange={(e) => setRemove(e.target.checked)} /> Remove profile lock</label>}
        {!locksAvailable && <p>Profile PINs are currently unavailable.</p>}
        {error && <p className="profile-picker-add-error" role="alert">{error}</p>}
        <div className="profile-picker-add-actions">
          <button className="btn-primary" type="submit" disabled={busy}>{busy ? 'Please wait…' : 'Save changes'}</button>
          <button className="btn-ghost" type="button" disabled={busy} onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
