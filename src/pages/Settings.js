import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BellSimple, Keyboard, Trash } from '@phosphor-icons/react';
import Navbar from '../components/Navbar';
import { useAuth } from '../contexts/AuthContext';
import { AUDIO_CHOICES, SUBTITLE_CHOICES, getPlaybackPrefs, savePlaybackPrefs } from '../utils/streamPreferences';
import { getSettings, saveSettings } from '../utils/profileSettings';
import {
  disableNewEpisodeAlerts, enableNewEpisodeAlerts, isSubscribed, pushPermission, pushSupported,
} from '../utils/pushNotifications';
import { dismissReminder, formatReminderTime, listReminders, REMINDERS_EVENT } from '../utils/reminders';
import { haptic, hapticsSupported } from '../utils/haptics';
import { updateAccountProfile } from '../utils/supabaseData';
import { supabase } from '../utils/supabase';
import { openShortcutsHelp } from '../components/KeyboardShortcuts';

function Switch({ checked, onChange, label, description, disabled = false }) {
  return (
    <div className="set-row">
      <div className="set-row-text">
        <span className="set-row-label">{label}</span>
        {description && <span className="set-row-desc">{description}</span>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`set-switch${checked ? ' on' : ''}`}
        onClick={() => { haptic(); onChange(!checked); }}
        disabled={disabled}
      >
        <span />
      </button>
    </div>
  );
}

function SelectRow({ label, description, value, options, onChange }) {
  return (
    <label className="set-row">
      <span className="set-row-text">
        <span className="set-row-label">{label}</span>
        {description && <span className="set-row-desc">{description}</span>}
      </span>
      <select className="set-select" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

// One place for everything a profile can tune. Saved per profile and
// synced, so it follows the profile to other devices.
export default function Settings() {
  const { activeProfile, refreshProfiles } = useAuth();
  const [prefs, setPrefs] = useState(() => getPlaybackPrefs());
  const [settings, setSettings] = useState(() => getSettings());
  const [alerts, setAlerts] = useState(null);
  const [reminders, setReminders] = useState([]);
  const [message, setMessage] = useState('');
  const [kidsPrompt, setKidsPrompt] = useState(false);
  const [password, setPassword] = useState('');
  const isKids = Boolean(activeProfile?.is_kids);

  useEffect(() => { isSubscribed().then(setAlerts).catch(() => setAlerts(false)); }, []);
  const loadReminders = useCallback(() => { listReminders().then(setReminders).catch(() => {}); }, []);
  useEffect(() => {
    loadReminders();
    window.addEventListener(REMINDERS_EVENT, loadReminders);
    return () => window.removeEventListener(REMINDERS_EVENT, loadReminders);
  }, [loadReminders]);

  function updatePrefs(patch) { setPrefs(savePlaybackPrefs(patch)); flash('Saved'); }
  function updateSettings(patch) { setSettings(saveSettings(patch)); flash('Saved'); }
  function flash(text) { setMessage(text); window.clearTimeout(flash.timer); flash.timer = window.setTimeout(() => setMessage(''), 1800); }

  async function toggleAlerts(next) {
    try {
      if (next) await enableNewEpisodeAlerts(); else await disableNewEpisodeAlerts();
      setAlerts(next);
      flash(next ? 'Notifications on' : 'Notifications off');
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function setKids(next) {
    if (!activeProfile) return;
    // Turning kids mode off needs the account password, so a child can't
    // just flip it back.
    if (!next) { setKidsPrompt(true); return; }
    await updateAccountProfile(activeProfile.id, { isKids: true });
    await refreshProfiles?.();
    flash('Kids mode on');
  }

  async function confirmKidsOff(event) {
    event.preventDefault();
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.auth.signInWithPassword({ email: user.email, password });
      if (error) throw new Error('That password isn’t right.');
      await updateAccountProfile(activeProfile.id, { isKids: false });
      await refreshProfiles?.();
      setKidsPrompt(false);
      setPassword('');
      flash('Kids mode off');
    } catch (error) {
      setMessage(error.message);
    }
  }

  const permission = pushPermission();

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content set-page">
        <header className="st-page-head">
          <div>
            <p className="st-page-kicker">{activeProfile?.name ? `${activeProfile.name}’s profile` : 'Your profile'}</p>
            <h1 className="st-page-title">Settings</h1>
          </div>
          <span className={`set-saved${message ? ' show' : ''}`} role="status">{message}</span>
        </header>

        <section className="set-card" aria-labelledby="set-playback">
          <h2 id="set-playback">Playback</h2>
          <SelectRow
            label="Audio language"
            description="Servers that play this language are tried first."
            value={prefs.audio}
            options={AUDIO_CHOICES}
            onChange={(audio) => updatePrefs({ audio })}
          />
          <SelectRow
            label="Subtitles"
            description="Turned on automatically where the server supports it."
            value={prefs.subtitles}
            options={SUBTITLE_CHOICES}
            onChange={(subtitles) => updatePrefs({ subtitles })}
          />
          <Switch
            label="Autoplay next episode"
            description="Up Next counts down and starts the next episode. Off: it waits for you."
            checked={settings.autoNext}
            onChange={(autoNext) => updateSettings({ autoNext })}
          />
          <Switch
            label="Data saver"
            description="Ask servers for lower quality and skip trailer previews."
            checked={settings.dataSaver}
            onChange={(dataSaver) => updateSettings({ dataSaver })}
          />
        </section>

        <section className="set-card" aria-labelledby="set-browsing">
          <h2 id="set-browsing">Browsing</h2>
          <Switch
            label="Autoplay previews"
            description="Muted trailers when you hover a title and in the banner at the top."
            checked={settings.previews}
            onChange={(previews) => updateSettings({ previews })}
          />
          <Switch
            label="Kids profile"
            description="Only titles rated for kids. Turning this off asks for the account password."
            checked={isKids}
            onChange={setKids}
            disabled={!activeProfile}
          />
          {kidsPrompt && (
            <form className="set-kids-form" onSubmit={confirmKidsOff}>
              <label htmlFor="set-kids-password">Account password</label>
              <div>
                <input id="set-kids-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
                <button type="submit" className="st-btn st-btn--primary">Turn off</button>
                <button type="button" className="st-btn st-btn--ghost" onClick={() => { setKidsPrompt(false); setPassword(''); }}>Cancel</button>
              </div>
            </form>
          )}
        </section>

        <section className="set-card" aria-labelledby="set-notify">
          <h2 id="set-notify">Notifications</h2>
          {pushSupported() ? (
            <Switch
              label="New episodes & reminders"
              description={permission === 'denied'
                ? 'Notifications are blocked for this site in your browser settings.'
                : 'A notification when a show you watch gets a new episode, and for reminders you set.'}
              checked={Boolean(alerts)}
              onChange={toggleAlerts}
              disabled={alerts === null || permission === 'denied'}
            />
          ) : (
            <p className="set-note">This browser can’t show notifications. On iPhone, add binge. to your Home Screen first. Reminders still appear in the app.</p>
          )}
          <div className="set-reminders">
            <span className="set-row-label">Upcoming reminders</span>
            {reminders.length === 0 ? (
              <p className="set-note">None. Use <BellSimple size={13} weight="bold" aria-label="Remind me" /> on a title to set one.</p>
            ) : (
              <ul>
                {reminders.map((reminder) => (
                  <li key={reminder.id}>
                    <Link to={reminder.url}>{reminder.title}</Link>
                    <span>{formatReminderTime(reminder.remind_at)}</span>
                    <button type="button" className="pf-icon-btn" onClick={() => dismissReminder(reminder.id)} aria-label={`Cancel reminder for ${reminder.title}`}>
                      <Trash size={15} weight="bold" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="set-card" aria-labelledby="set-device">
          <h2 id="set-device">This device</h2>
          {hapticsSupported() ? (
            <Switch
              label="Vibration feedback"
              description="A light tap when you play, save or rate."
              checked={settings.haptics}
              onChange={(haptics) => updateSettings({ haptics })}
            />
          ) : window.matchMedia?.('(pointer: coarse)').matches ? (
            <p className="set-note">Vibration feedback isn’t available in this browser (iPhones don’t allow it for web apps).</p>
          ) : null}
          <div className="set-row">
            <div className="set-row-text">
              <span className="set-row-label">Keyboard shortcuts</span>
              <span className="set-row-desc">Browse with arrow keys, / to search, ? for the full list.</span>
            </div>
            <button type="button" className="st-btn st-btn--ghost" onClick={openShortcutsHelp}><Keyboard size={16} weight="bold" /> Show</button>
          </div>
        </section>

        <p className="set-footer">
          <Link to="/history">Watch history</Link>
          <span aria-hidden="true">·</span>
          {activeProfile?.is_default !== false && <Link to="/account-settings">Email &amp; password</Link>}
        </p>
      </main>
    </div>
  );
}
