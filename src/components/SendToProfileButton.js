import { useEffect, useRef, useState } from 'react';
import { PaperPlaneTilt } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { sendToProfile } from '../utils/profileShares';
import { haptic } from '../utils/haptics';

// "Send to…" another profile on this account; it shows up in their
// "Sent to you" row on Home (website and TV).
export default function SendToProfileButton({ item, mediaType }) {
  const { profiles = [], activeProfile } = useAuth();
  const others = profiles.filter((profile) => profile.id !== activeProfile?.id);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onDown(event) { if (!wrapRef.current?.contains(event.target)) setOpen(false); }
    function onKey(event) { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); } }
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  if (!others.length || !item?.id) return null;

  async function send(profile) {
    setOpen(false);
    try {
      await sendToProfile({ toProfile: profile.id, mediaType, mediaId: item.id });
      haptic('success');
      toast(`Sent to ${profile.name}`, { description: 'It’s in their “Sent to you” row on Home.' });
    } catch (error) {
      toast(error.message);
    }
  }

  return (
    <div className="td-remind" ref={wrapRef}>
      <button
        type="button"
        className="td-round-btn"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Send to another profile"
        title="Send to…"
      >
        <PaperPlaneTilt size={20} weight="bold" />
      </button>
      {open && (
        <div className="td-remind-menu" role="menu" aria-label="Send to">
          <p>Send to</p>
          {others.map((profile) => (
            <button key={profile.id} type="button" role="menuitem" onClick={() => send(profile)}>{profile.name}</button>
          ))}
        </div>
      )}
    </div>
  );
}
