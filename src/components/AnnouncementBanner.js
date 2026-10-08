import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Info, Warning, WarningOctagon, X } from '@phosphor-icons/react';
import { supabase, isSupabaseConfigured } from '../utils/supabase';

const DISMISSED_KEY = 'binge:dismissed-announcements';
const ICONS = { info: Info, warning: Warning, critical: WarningOctagon };
export const ANNOUNCEMENTS_EVENT = 'binge:announcements';

function dismissed() {
  try { return new Set(JSON.parse(window.localStorage.getItem(DISMISSED_KEY) || '[]')); } catch { return new Set(); }
}

// Site-wide message posted from the admin panel (site_announcements):
// maintenance, a server being down, new features. One at a time, newest
// first; dismissing hides that announcement on this device.
export default function AnnouncementBanner() {
  const [announcement, setAnnouncement] = useState(null);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return undefined;
    let cancelled = false;
    async function load() {
      const now = new Date().toISOString();
      const { data } = await supabase
        .from('site_announcements')
        .select('id, message, level, link_url, link_label, starts_at, ends_at')
        .eq('active', true)
        .lte('starts_at', now)
        .order('created_at', { ascending: false })
        .limit(5);
      if (cancelled) return;
      const hidden = dismissed();
      setAnnouncement((data || []).find((row) => !hidden.has(row.id) && (!row.ends_at || row.ends_at > now)) || null);
    }
    load().catch(() => {});
    const timer = setInterval(() => load().catch(() => {}), 5 * 60 * 1000);
    window.addEventListener(ANNOUNCEMENTS_EVENT, load);
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener(ANNOUNCEMENTS_EVENT, load); };
  }, []);

  if (!announcement) return null;
  const Icon = ICONS[announcement.level] || Info;
  const internal = announcement.link_url?.startsWith('/');

  function dismiss() {
    const hidden = dismissed();
    hidden.add(announcement.id);
    try { window.localStorage.setItem(DISMISSED_KEY, JSON.stringify([...hidden].slice(-50))); } catch { /* private mode */ }
    setAnnouncement(null);
  }

  return (
    <div className={`site-banner site-banner--${announcement.level}`} role={announcement.level === 'critical' ? 'alert' : 'status'}>
      <Icon size={18} weight="fill" aria-hidden="true" />
      <p>
        {announcement.message}
        {announcement.link_url && (internal
          ? <> <Link to={announcement.link_url}>{announcement.link_label || 'Learn more'}</Link></>
          : <> <a href={announcement.link_url} target="_blank" rel="noopener noreferrer">{announcement.link_label || 'Learn more'}</a></>)}
      </p>
      <button type="button" onClick={dismiss} aria-label="Dismiss announcement"><X size={16} weight="bold" /></button>
    </div>
  );
}
