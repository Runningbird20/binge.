import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BellSimple, Keyboard, Star, Trash } from '@phosphor-icons/react';
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
import { FOLLOWABLE_LEAGUES, followTeam, listFollowedTeams, setTeamAlerts, TEAMS_EVENT, unfollowTeam } from '../utils/teams';
import { fetchLeagueTeams } from '../utils/liveScores';

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
    <label className="set-row set-row--select">
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

// Follow teams: their games lead Sports, and (with notifications on) the
// server sends a heads-up before kickoff and when a game gets close.
function TeamsSettings() {
  const [teams, setTeams] = useState([]);
  const [league, setLeague] = useState('');
  const [options, setOptions] = useState(null);

  useEffect(() => {
    const load = () => listFollowedTeams().then(setTeams);
    load();
    window.addEventListener(TEAMS_EVENT, load);
    return () => window.removeEventListener(TEAMS_EVENT, load);
  }, []);

  useEffect(() => {
    setOptions(null);
    if (!league) return undefined;
    let cancelled = false;
    fetchLeagueTeams(league).then((list) => { if (!cancelled) setOptions(list); }).catch(() => { if (!cancelled) setOptions([]); });
    return () => { cancelled = true; };
  }, [league]);

  const followedIds = new Set(teams.filter((team) => team.league_path === league).map((team) => team.team_id));

  return (
    <section className="set-card" aria-labelledby="set-teams">
      <h2 id="set-teams">Your teams</h2>
      {teams.length === 0 && <p className="set-note">Follow teams to put their games first on Sports and get alerts when they start or get close.</p>}
      {teams.length > 0 && (
        <ul className="set-teams">
          {teams.map((team) => (
            <li key={team.id}>
              {team.logo ? <img src={team.logo} alt="" /> : <Star size={18} weight="fill" />}
              <span className="set-team-name">{team.team_name}</span>
              <button
                type="button"
                role="switch"
                aria-checked={team.alerts}
                className={`set-switch set-switch--sm${team.alerts ? ' on' : ''}`}
                onClick={() => setTeamAlerts(team.id, !team.alerts)}
                aria-label={`Alerts for ${team.team_name}`}
                title="Game alerts"
              ><span /></button>
              <button type="button" className="pf-icon-btn" onClick={() => unfollowTeam(team.id)} aria-label={`Unfollow ${team.team_name}`}>
                <Trash size={15} weight="bold" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className="set-row set-row--select">
        <span className="set-row-text">
          <span className="set-row-label">Add a team</span>
          <span className="set-row-desc">Alerts: 30 minutes before start, close games late, overtime, and no-hitters.</span>
        </span>
        <select className="set-select" value={league} onChange={(event) => setLeague(event.target.value)}>
          <option value="">Choose a league…</option>
          {FOLLOWABLE_LEAGUES.map(([path, label]) => <option key={path} value={path}>{label}</option>)}
        </select>
      </label>
      {league && (
        <div className="set-team-grid">
          {!options && <div className="hm-skeleton skeleton-block" aria-hidden="true" />}
          {options?.map((team) => {
            const on = followedIds.has(String(team.id));
            return (
              <button
                key={team.id}
                type="button"
                className={`set-team-pick${on ? ' on' : ''}`}
                aria-pressed={on}
                onClick={() => (on
                  ? unfollowTeam(teams.find((row) => row.league_path === league && row.team_id === String(team.id))?.id)
                  : followTeam({ leaguePath: league, team }))}
              >
                {team.logo && <img src={team.logo} alt="" loading="lazy" />}
                <span>{team.name}</span>
                {on && <Star size={14} weight="fill" />}
              </button>
            );
          })}
        </div>
      )}
    </section>
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
            <h1 className="st-page-title">Settings</h1>
            <p className="st-page-sub">{activeProfile?.name ? `For ${activeProfile.name}’s profile on every device.` : 'For your profile on every device.'}</p>
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
            label="Captions first"
            description="With subtitles on, start on servers that show them automatically (marked CC)."
            checked={settings.captionsFirst !== false}
            onChange={(captionsFirst) => updateSettings({ captionsFirst })}
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

        <TeamsSettings />

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

        <section className="set-card" aria-labelledby="set-import">
          <h2 id="set-import">Your history</h2>
          <div className="set-row">
            <div className="set-row-text">
              <span className="set-row-label">Import from Letterboxd, IMDb, Trakt or Netflix</span>
              <span className="set-row-desc">Bring your ratings and watch history so your picks are good from day one.</span>
            </div>
            <Link to="/import" className="st-btn st-btn--ghost">Import</Link>
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
