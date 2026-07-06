import { useLocation, useNavigate } from 'react-router-dom';
import {
  House,
  MagnifyingGlass,
  Sparkle,
} from '@phosphor-icons/react';
import { useAuth } from '../contexts/AuthContext';
import UserAvatar from './UserAvatar';

const SIZE = 24;

const TABS = [
  {
    id: 'home',
    label: 'Home',
    path: '/home',
    icon: (active) => (
      <House size={SIZE} weight={active ? 'fill' : 'regular'} />
    ),
  },
  {
    id: 'search',
    label: 'Search',
    action: 'search',
    icon: (active) => (
      <MagnifyingGlass size={SIZE} weight={active ? 'fill' : 'regular'} />
    ),
  },
  {
    id: 'profile',
    label: 'Profile',
    action: 'profile',
    icon: null, // rendered separately as avatar
  },
  {
    id: 'ai',
    label: 'For You',
    action: 'ai',
    icon: () => <Sparkle size={SIZE} weight="duotone" />,
  },
];

export default function BottomNav() {
  const location = useLocation();
  const navigate  = useNavigate();
  const { user }  = useAuth();

  function handleTab(tab) {
    if (tab.path) {
      navigate(tab.path);
      return;
    }
    if (tab.action === 'search') {
      window.dispatchEvent(new CustomEvent('binge:openSearch'));
      return;
    }
    if (tab.action === 'profile') {
      if (user?.username) navigate(`/profile/${user.username}`);
      else navigate('/account-settings');
      return;
    }
    if (tab.action === 'ai') {
      window.dispatchEvent(new CustomEvent('binge:openAI'));
      return;
    }
  }

  function isActive(tab) {
    if (!tab.path) return false;
    if (tab.path === '/home') return location.pathname === '/home';
    return location.pathname.startsWith(tab.path);
  }

  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      {TABS.map((tab) => {
        const active = isActive(tab);
        const isAI = tab.id === 'ai';
        const isProfile = tab.id === 'profile';

        return (
          <button
            key={tab.id}
            type="button"
            className={`bottom-nav-item ${active ? 'active' : ''} ${isAI ? 'bottom-nav-ai' : ''}`}
            onClick={() => handleTab(tab)}
            aria-label={tab.label}
            aria-current={active ? 'page' : undefined}
          >
            <span className={`bottom-nav-icon ${isAI ? 'bottom-nav-ai-icon' : ''}`}>
              {isProfile ? (
                <span className={`bottom-nav-avatar ${active ? 'active' : ''}`}>
                  <UserAvatar
                    avatarUrl={user?.avatarUrl || user?.avatar_url}
                    name={user?.username || user?.name || ''}
                    size="sm"
                  />
                </span>
              ) : (
                tab.icon(active)
              )}
            </span>
            {isAI && <span className="bottom-nav-label bottom-nav-ai-label">{tab.label}</span>}
          </button>
        );
      })}
    </nav>
  );
}
