import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import {
  INBOX_READ_EVENT, inboxIdFromLink, markNotificationsRead, withoutInboxId,
} from '../utils/notificationsInbox';

// Opened from a push (…?notif=ID, added by public/sw.js): that alert is read.
// Marks its inbox row, tells a bell already on screen (INBOX_READ_EVENT), and
// takes ?notif= out of the address bar with replaceState, not a navigation, so
// the page's own parameters (play=1, season…) aren't acted on twice. Mounted
// in AppShell while someone is signed in, so it works on every page a push
// opens, with or without the bell.
export default function PushOpenedWatcher() {
  const location = useLocation();

  useEffect(() => {
    const id = inboxIdFromLink(location.search);
    if (!id) return;
    try {
      window.history.replaceState(window.history.state, '', withoutInboxId(window.location.href));
    } catch { /* the id just stays in the address */ }
    markNotificationsRead([id])
      .then(() => window.dispatchEvent(new CustomEvent(INBOX_READ_EVENT, { detail: [id] })))
      .catch(() => {});
  }, [location.search]);

  return null;
}
