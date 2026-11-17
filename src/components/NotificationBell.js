import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Alarm, Bell, CheckCircle, HardDrives, Megaphone, Television, Trophy } from '@phosphor-icons/react';
import { useAuth } from '../contexts/AuthContext';
import useDeviceType from '../hooks/useDeviceType';
import useNotifications from '../hooks/useNotifications';
import { INBOX_DAYS, timeAgo } from '../utils/notificationsInbox';
import BottomSheet from './BottomSheet';
import LoadingBar from './LoadingBar';

const KIND_ICONS = { episode: Television, reminder: Alarm, game: Trophy, announcement: Megaphone, server: HardDrives };

// The bell in the header, left of the profile (on phones, the top right):
// the last 30 days of alerts (utils/notificationsInbox.js), a dot on each
// unread one and on the bell while any are. Opening one marks it read and goes
// to its link. A dropdown on computers and TVs, a bottom sheet on phones
// (portaled: the header's backdrop-filter would trap a fixed overlay inside it).
export default function NotificationBell() {
  const { activeProfile } = useAuth();
  const { isMobile } = useDeviceType();
  const navigate = useNavigate();
  const inbox = useNotifications(activeProfile?.id || null);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const buttonRef = useRef(null);
  const panelId = useId();
  const close = useCallback(() => setOpen(false), []);

  // The dropdown closes on a click outside it or Escape (the sheet does both itself).
  useEffect(() => {
    if (!open || isMobile) return undefined;
    function onPointerDown(event) {
      if (!wrapRef.current?.contains(event.target)) setOpen(false);
    }
    function onKeyDown(event) {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, isMobile]);

  function toggle() {
    if (!open) inbox.refresh();
    setOpen(!open);
  }

  function openItem(item) {
    inbox.markRead([item.id]);
    setOpen(false);
    if (item.url) navigate(item.url);
  }

  const unreadCount = inbox.unreadIds.length;
  const list = <InboxList inbox={inbox} onOpen={openItem} heading={!isMobile} />;

  return (
    <div className="nav-inbox" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`nav-inbox-btn${open ? ' is-open' : ''}`}
        aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        title="Notifications"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open && !isMobile ? panelId : undefined}
        onClick={toggle}
      >
        <Bell size={20} weight="bold" aria-hidden="true" />
        {unreadCount > 0 && <span className="nav-inbox-badge" aria-hidden="true" />}
      </button>
      {isMobile
        ? createPortal(<BottomSheet open={open} onClose={close} title="Notifications">{list}</BottomSheet>, document.body)
        : open && (
          <div className="nav-inbox-panel" id={panelId} role="dialog" aria-label="Notifications">
            <div className="nav-inbox-card">{list}</div>
          </div>
        )}
    </div>
  );
}

function InboxList({ inbox, onOpen, heading }) {
  const { items, failed, unreadIds } = inbox;
  let content;
  if (!items && failed) {
    content = (
      <div className="nav-inbox-empty">
        <p>Couldn’t load your notifications.</p>
        <button type="button" className="td-mark-season nav-inbox-action" onClick={inbox.reload}>Try again</button>
      </div>
    );
  } else if (!items) {
    content = <LoadingBar label="Loading notifications…" compact />;
  } else if (!items.length) {
    content = (
      <div className="nav-inbox-empty">
        <p className="nav-inbox-caught-up"><CheckCircle size={20} weight="bold" aria-hidden="true" /> All caught up</p>
        <p>New episodes, reminders, your teams’ games and announcements show up here.</p>
      </div>
    );
  } else {
    content = (
      <ul className="nav-inbox-list">
        {items.map((item) => <InboxItem key={item.id} item={item} onOpen={onOpen} />)}
      </ul>
    );
  }
  return (
    <>
      <div className="nav-inbox-head">
        <div>
          {heading && <h2 className="nav-inbox-title">Notifications</h2>}
          <p className="nav-inbox-sub">The last {INBOX_DAYS} days</p>
        </div>
        {unreadIds.length > 0 && (
          <button type="button" className="td-mark-season nav-inbox-action" onClick={() => inbox.markRead(unreadIds)}>
            Mark all read
          </button>
        )}
      </div>
      {content}
    </>
  );
}

function InboxItem({ item, onOpen }) {
  const Icon = KIND_ICONS[item.kind] || Bell;
  const unread = !item.read_at;
  return (
    <li>
      <button type="button" className={`nav-inbox-item${unread ? ' is-unread' : ''}`} onClick={() => onOpen(item)}>
        <span className="nav-inbox-icon"><Icon size={18} weight="bold" aria-hidden="true" /></span>
        <span className="nav-inbox-text">
          <span className="nav-inbox-item-title">{unread && <span className="sr-only">Unread: </span>}{item.title}</span>
          {item.body && <span className="nav-inbox-item-body">{item.body}</span>}
          <time className="nav-inbox-time" dateTime={item.created_at}>{timeAgo(item.created_at)}</time>
        </span>
        {unread && <span className="nav-inbox-dot" aria-hidden="true" />}
      </button>
    </li>
  );
}
