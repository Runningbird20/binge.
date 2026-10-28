import { useState } from 'react';
import { requireSupabaseClient } from '../utils/supabase';
import { signInWithSupabase, updateAccountProfile } from '../utils/supabaseData';

export default function ProfileSecurityDialog({ profile, email, editing, locked, onCancel, onSaved, onUnlock }) {
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
    if (editing && pin && !remove && pin !== confirm) return setError('PINs do not match.');
    setBusy(true);
    try {
      const client = requireSupabaseClient();
      if (editing) {
        await signInWithSupabase({ email, password });
        if (pin || remove) {
          const { error: lockError } = await client.rpc('set_profile_lock', { target_profile: profile.id, new_pin: remove ? null : pin });
          if (lockError) throw lockError;
        }
        await updateAccountProfile(profile.id, { isKids });
        await onSaved();
      } else {
        const { data, error: verifyError } = await client.rpc('verify_profile_pin', { target_profile: profile.id, entered_pin: pin });
        if (verifyError) throw verifyError;
        if (!data) throw new Error('Incorrect PIN or too many attempts. After five attempts, wait five minutes.');
        onUnlock();
      }
    } catch (err) { setError(err.message || 'Unable to save profile.'); }
    finally { setBusy(false); }
  }
  return (
    <div className="profile-delete-overlay">
      <form className="profile-delete-card profile-security-card" role="dialog" aria-modal="true" aria-labelledby="profile-security-title" onSubmit={submit}>
        <h3 id="profile-security-title">{editing ? 'Edit' : 'Unlock'} {profile.name}</h3>
        {editing && <>
          <label>Age rating<select className="profile-picker-add-input" value={isKids ? 'kids' : 'all'} onChange={(e) => setIsKids(e.target.value === 'kids')}>
            <option value="all">All ratings</option><option value="kids">Kids — G, PG, TV-Y, TV-Y7, TV-G, TV-PG</option>
          </select></label>
          <label>Account password<input className="profile-picker-add-input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <p>Confirm your account password to change age restrictions or the profile lock.</p>
        </>}
        {!remove && <label>{editing ? locked ? 'New four-digit PIN (leave blank to keep)' : 'Four-digit PIN (optional)' : 'Four-digit PIN'}
          <input className="profile-picker-add-input" type="password" inputMode="numeric" autoComplete="off" maxLength={4} pattern="[0-9]{4}" required={!editing} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
        </label>}
        {editing && pin && !remove && <label>Confirm PIN<input className="profile-picker-add-input" type="password" inputMode="numeric" maxLength={4} required value={confirm} onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ''))} /></label>}
        {editing && locked && <label><input type="checkbox" checked={remove} onChange={(e) => setRemove(e.target.checked)} /> Remove profile lock</label>}
        {error && <p className="profile-picker-add-error" role="alert">{error}</p>}
        <div className="profile-picker-add-actions">
          <button className="btn-primary" type="submit" disabled={busy}>{busy ? 'Please wait…' : editing ? 'Save changes' : 'Unlock'}</button>
          <button className="btn-ghost" type="button" disabled={busy} onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
