import { useCallback, useEffect, useRef, useState } from 'react';
import { INBOX_AVAILABLE, fetchNotifications, markNotificationsRead } from '../utils/notificationsInbox';

const REFRESH_MS = 5 * 60 * 1000;
const RETURN_REFRESH_MS = 60 * 1000;

// The signed-in profile's notification inbox (utils/notificationsInbox.js).
// Loads when the profile changes, every 5 minutes while the tab is visible,
// and on refresh() (the tab coming back into view, the list opening) unless
// the last load is under a minute old; reload() loads now (Try again).
// items is null until the first load; failed says the last
// load didn't work. Marking read shows at once and drops any load still
// running (it would bring the dot back); if the save fails, the next load does.
export default function useNotifications(profileId) {
  const [items, setItems] = useState(() => (INBOX_AVAILABLE ? null : []));
  const [failed, setFailed] = useState(false);
  const loadedAt = useRef(0);
  const latest = useRef(0);

  const reload = useCallback(async () => {
    if (!INBOX_AVAILABLE) return;
    const request = latest.current + 1;
    latest.current = request;
    try {
      const rows = await fetchNotifications({ profileId });
      if (request !== latest.current) return;
      setItems(rows);
      setFailed(false);
    } catch {
      if (request === latest.current) setFailed(true);
    } finally {
      loadedAt.current = Date.now();
    }
  }, [profileId]);

  // A load unless the last one is under a minute old.
  const refresh = useCallback(() => {
    if (Date.now() - loadedAt.current > RETURN_REFRESH_MS) reload();
  }, [reload]);

  useEffect(() => {
    if (!INBOX_AVAILABLE) return undefined;
    setItems(null);
    setFailed(false);
    reload();
    const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
    const timer = setInterval(() => { if (visible()) reload(); }, REFRESH_MS);
    function onReturn() {
      if (visible()) refresh();
    }
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('focus', onReturn);
    return () => {
      latest.current += 1; // a load still running belongs to the old profile
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('focus', onReturn);
    };
  }, [reload, refresh]);

  const markRead = useCallback((ids) => {
    if (!ids.length) return;
    latest.current += 1; // a load already running predates this: drop it
    const marked = new Set(ids);
    const at = new Date().toISOString();
    setItems((current) => current && current.map((item) => (marked.has(item.id) && !item.read_at ? { ...item, read_at: at } : item)));
    markNotificationsRead(ids).catch(() => {});
  }, []);

  const unread = (items || []).filter((item) => !item.read_at);
  return { items, failed, reload, refresh, markRead, unreadIds: unread.map((item) => item.id) };
}
