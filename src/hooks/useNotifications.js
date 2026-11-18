import { useCallback, useEffect, useRef, useState } from 'react';
import {
  INBOX_AVAILABLE, INBOX_READ_EVENT, belongsToProfile, fetchNotifications, markNotificationsRead, subscribeToInbox,
} from '../utils/notificationsInbox';

const POLL_MS = 5 * 60 * 1000; // while Realtime isn't connected
const LIVE_POLL_MS = 30 * 60 * 1000; // a safety net while it is
const RETURN_REFRESH_MS = 60 * 1000;
const CHANGE_DELAY_MS = 400; // "Mark all read" elsewhere sends one change per alert

// The signed-in profile's notification inbox (utils/notificationsInbox.js).
// New alerts arrive at once through Supabase Realtime (given userId), which
// reloads the list; so do read marks made on another device. Each time the
// channel connects (and reconnects after a drop) the list reloads, so nothing
// sent meanwhile is missed. While it isn't connected, the list reloads every
// 5 minutes the tab is visible (every 30 while it is, as a safety net).
// It also loads when the profile changes, and on refresh() (the tab coming
// back into view, the list opening) unless the last load is under a minute
// old; reload() loads now (Try again).
// items is null until the first load; failed says the last load didn't work.
// Marking read shows at once and drops any load still running (it would bring
// the dot back); if the save fails, the next load does. An alert marked read
// by opening its push (INBOX_READ_EVENT) reloads the list.
export default function useNotifications(profileId, userId = null) {
  const [items, setItems] = useState(() => (INBOX_AVAILABLE ? null : []));
  const [failed, setFailed] = useState(false);
  const loadedAt = useRef(0);
  const latest = useRef(0);
  const live = useRef(false);
  const profileRef = useRef(profileId);
  profileRef.current = profileId;

  const reload = useCallback(async () => {
    if (!INBOX_AVAILABLE) return;
    const request = latest.current + 1;
    latest.current = request;
    loadedAt.current = Date.now(); // a slow load mustn't let the poll start more
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
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

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
    const timer = setInterval(() => {
      if (visible() && Date.now() - loadedAt.current >= (live.current ? LIVE_POLL_MS : POLL_MS)) reload();
    }, RETURN_REFRESH_MS);
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

  // Realtime: one channel per account; the profile is checked per change.
  useEffect(() => {
    if (!INBOX_AVAILABLE || !userId) return undefined;
    let pending = null;
    const unsubscribe = subscribeToInbox(userId, {
      onChange(row) {
        if (!belongsToProfile(row, profileRef.current)) return;
        clearTimeout(pending);
        pending = setTimeout(() => reloadRef.current(), CHANGE_DELAY_MS);
      },
      onStatus(status) {
        live.current = status === 'SUBSCRIBED';
        if (live.current) reloadRef.current();
      },
    });
    return () => {
      clearTimeout(pending);
      live.current = false;
      unsubscribe();
    };
  }, [userId]);

  // Opening a push marked its alert read (already saved): load the list again.
  // Not patched in place, because it often lands while the first load is
  // still running, which a patch would have to drop.
  useEffect(() => {
    if (!INBOX_AVAILABLE) return undefined;
    const onRead = () => reloadRef.current();
    window.addEventListener(INBOX_READ_EVENT, onRead);
    return () => window.removeEventListener(INBOX_READ_EVENT, onRead);
  }, []);

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
