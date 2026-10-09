import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bell, ChartLineUp, HardDrives, Megaphone, Bug, Users } from '@phosphor-icons/react';
import Navbar from '../components/Navbar';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';
import AdminOverview from './admin/AdminOverview';
import AdminServers from './admin/AdminServers';
import AdminSportsServers from './admin/AdminSportsServers';
import AdminErrors from './admin/AdminErrors';
import AdminAnnouncements from './admin/AdminAnnouncements';
import AdminBroadcast from './admin/AdminBroadcast';
import AdminUsersPanel from './admin/AdminUsersPanel';

const TABS = [
  { id: 'overview', label: 'Overview', Icon: ChartLineUp },
  { id: 'servers', label: 'Servers', Icon: HardDrives },
  { id: 'errors', label: 'Errors', Icon: Bug },
  { id: 'announcements', label: 'Announcements', Icon: Megaphone },
  { id: 'notify', label: 'Notifications', Icon: Bell },
  { id: 'users', label: 'Users', Icon: Users },
];

// Admin control center: site health, what people watch, errors, and tools to
// talk to users — all on binge.'s own data (no third-party services).
export default function AdminHome() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((entry) => entry.id === params.get('tab')) ? params.get('tab') : 'overview';
  const [badges, setBadges] = useState({});

  useEffect(() => {
    supabase.rpc('admin_stats').then(({ data }) => {
      if (data) setBadges({ errors: data.errors_24h, devices: data.push_devices });
    });
    supabase.from('server_status').select('provider', { count: 'exact', head: true }).eq('status', 'down')
      .then(({ count }) => setBadges((current) => ({ ...current, servers: count || 0 })));
  }, []);

  const open = (id) => setParams(id === 'overview' ? {} : { tab: id });

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content adm-page">
        <header className="st-page-head">
          <div>
            <h1 className="st-page-title">Admin</h1>
            <p className="st-page-sub">Signed in as {user?.username}.</p>
          </div>
        </header>

        <nav className="st-tabs adm-tabs" aria-label="Admin sections">
          {TABS.map(({ id, label, Icon }) => {
            const count = id === 'errors' ? badges.errors : id === 'servers' ? badges.servers : 0;
            return (
              <button key={id} type="button" className={`st-tab${tab === id ? ' active' : ''}`} aria-current={tab === id ? 'page' : undefined} onClick={() => open(id)}>
                <Icon size={16} weight="bold" aria-hidden="true" /> {label}
                {count > 0 && <span className="adm-badge" aria-label={`${count} need attention`}>{count}</span>}
              </button>
            );
          })}
        </nav>

        {tab === 'overview' && <AdminOverview onOpenTab={open} />}
        {tab === 'servers' && <><AdminServers /><AdminSportsServers /></>}
        {tab === 'errors' && <AdminErrors />}
        {tab === 'announcements' && <AdminAnnouncements />}
        {tab === 'notify' && <AdminBroadcast deviceCount={badges.devices} />}
        {tab === 'users' && <AdminUsersPanel />}
      </main>
    </div>
  );
}
