import { NavLink } from 'react-router-dom';
import {
  House,
  Broadcast,
  Trophy,
  FilmSlate,
  MonitorPlay,
  BookOpen,
} from '@phosphor-icons/react';

// Mirrors Navbar's desktop NAV_LINKS so mobile gets the same primary
// navigation as the site, in the same order with the same icons.
const TABS = [
  { to: '/home',     label: 'Home',   Icon: House },
  { to: '/live-tv',  label: 'Live',   Icon: Broadcast },
  { to: '/sports',   label: 'Sports', Icon: Trophy },
  { to: '/movies',   label: 'Movies', Icon: FilmSlate },
  { to: '/tv-shows', label: 'Series', Icon: MonitorPlay },
  { to: '/books',    label: 'Books',  Icon: BookOpen },
];

export default function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      {TABS.map(({ to, label, Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}
          aria-label={label}
        >
          {({ isActive }) => (
            <>
              <span className="bottom-nav-icon">
                <Icon size={21} weight={isActive ? 'fill' : 'regular'} aria-hidden="true" />
              </span>
              <span className="bottom-nav-label">{label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
