import { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  BookOpen,
  ClockCounterClockwise,
  FilmSlate,
  GearSix,
  House,
  MagnifyingGlass,
  MonitorPlay,
  SignOut,
  Sparkle,
  SquaresFour,
  Trophy,
  UserCircle,
  UsersFour,
} from '@phosphor-icons/react';
import { useAuth } from '../contexts/AuthContext';
import BottomSheet from './BottomSheet';
import ProfileAvatar from './ProfileAvatar';
import { haptic } from '../utils/haptics';

// Phone navigation, all at thumb height: Home · Sports · Browse · Search · Me.
// Browse goes straight to the last catalog you used (tap again to switch
// between Movies / Series / Books); Me holds profile, settings and sign out,
// so nothing important lives at the top of the screen.
const BROWSE = [
  { to: '/movies',   label: 'Movies', Icon: FilmSlate },
  { to: '/tv-shows', label: 'Series', Icon: MonitorPlay },
  { to: '/books',    label: 'Books',  Icon: BookOpen },
];
const BROWSE_KEY = 'binge:last-browse';

function lastBrowse() {
  try { return window.localStorage.getItem(BROWSE_KEY) || '/movies'; } catch { return '/movies'; }
}

export default function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, activeProfile, profiles, logout } = useAuth();
  const [sheet, setSheet] = useState(null); // 'browse' | 'me'
  const onBrowse = BROWSE.find((entry) => location.pathname.startsWith(entry.to));

  function goBrowse(to) {
    try { window.localStorage.setItem(BROWSE_KEY, to); } catch { /* private mode */ }
    setSheet(null);
    navigate(to);
  }

  function tab(isActive) {
    return `bottom-nav-item${isActive ? ' active' : ''}`;
  }

  const name = activeProfile?.name || user?.username || 'Me';

  return (
    <>
      <nav className="bottom-nav" aria-label="Main navigation">
        <NavLink to="/home" className={({ isActive }) => tab(isActive)} onClick={() => haptic()}>
          {({ isActive }) => (
            <>
              <span className="bottom-nav-icon"><House size={21} weight={isActive ? 'fill' : 'regular'} aria-hidden="true" /></span>
              <span className="bottom-nav-label">Home</span>
            </>
          )}
        </NavLink>
        <NavLink to="/sports" className={({ isActive }) => tab(isActive)} onClick={() => haptic()}>
          {({ isActive }) => (
            <>
              <span className="bottom-nav-icon"><Trophy size={21} weight={isActive ? 'fill' : 'regular'} aria-hidden="true" /></span>
              <span className="bottom-nav-label">Sports</span>
            </>
          )}
        </NavLink>
        <button
          type="button"
          className={tab(Boolean(onBrowse))}
          aria-haspopup={onBrowse ? 'dialog' : undefined}
          onClick={() => { haptic(); if (onBrowse) setSheet('browse'); else goBrowse(lastBrowse()); }}
        >
          <span className="bottom-nav-icon">
            {onBrowse ? <onBrowse.Icon size={21} weight="fill" aria-hidden="true" /> : <SquaresFour size={21} aria-hidden="true" />}
          </span>
          <span className="bottom-nav-label">{onBrowse ? onBrowse.label : 'Browse'}</span>
        </button>
        <NavLink to="/search" className={({ isActive }) => tab(isActive)} onClick={() => haptic()}>
          {({ isActive }) => (
            <>
              <span className="bottom-nav-icon"><MagnifyingGlass size={21} weight={isActive ? 'bold' : 'regular'} aria-hidden="true" /></span>
              <span className="bottom-nav-label">Search</span>
            </>
          )}
        </NavLink>
        <button
          type="button"
          className={tab(['/profile', '/settings', '/history', '/wrapped', '/profiles'].some((path) => location.pathname.startsWith(path)))}
          aria-haspopup="dialog"
          onClick={() => { haptic(); setSheet('me'); }}
        >
          <span className="bottom-nav-icon">
            {activeProfile ? <ProfileAvatar profile={activeProfile} size={22} /> : <UserCircle size={22} aria-hidden="true" />}
          </span>
          <span className="bottom-nav-label">Me</span>
        </button>
      </nav>

      <BottomSheet open={sheet === 'browse'} onClose={() => setSheet(null)} title="Browse">
        <div className="bn-browse">
          {BROWSE.map(({ to, label, Icon }) => (
            <button key={to} type="button" className={`bn-browse-item${onBrowse?.to === to ? ' active' : ''}`} onClick={() => goBrowse(to)}>
              <Icon size={26} weight={onBrowse?.to === to ? 'fill' : 'regular'} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      </BottomSheet>

      <BottomSheet open={sheet === 'me'} onClose={() => setSheet(null)} title={name}>
        {[
          { to: '/profile', label: 'Profile & stats', Icon: UserCircle },
          { to: '/settings', label: 'Settings', Icon: GearSix },
          { to: '/history', label: 'Watch history', Icon: ClockCounterClockwise },
          { to: '/wrapped', label: `${new Date().getFullYear()} Wrapped`, Icon: Sparkle },
          { to: '/profiles', label: profiles?.length > 1 ? 'Switch profile' : 'Manage profiles', Icon: UsersFour },
        ].map(({ to, label, Icon }) => (
          <button key={to} type="button" className="bsheet-option bn-me-item" onClick={() => { setSheet(null); navigate(to); }}>
            <span><Icon size={19} weight="bold" aria-hidden="true" /> {label}</span>
          </button>
        ))}
        <button
          type="button"
          className="bsheet-option bn-me-item bn-me-logout"
          onClick={async () => { setSheet(null); try { await logout(); } finally { navigate('/'); } }}
        >
          <span><SignOut size={19} weight="bold" aria-hidden="true" /> Log out</span>
        </button>
      </BottomSheet>
    </>
  );
}
