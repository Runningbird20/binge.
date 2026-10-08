import { useEffect, useState } from 'react';
import { WifiSlash } from '@phosphor-icons/react';

// "You're offline" strip. Saved art and pages already loaded keep working
// (service worker), but streams, search and saving need a connection.
export default function OfflineBanner() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  const [backOnline, setBackOnline] = useState(false);

  useEffect(() => {
    let timer = null;
    function up() {
      setOnline(true);
      setBackOnline(true);
      clearTimeout(timer);
      timer = setTimeout(() => setBackOnline(false), 2500);
    }
    function down() { setOnline(false); setBackOnline(false); }
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
      clearTimeout(timer);
    };
  }, []);

  if (online && !backOnline) return null;
  return (
    <div className={`st-offline${online ? ' st-offline--back' : ''}`} role="status" aria-live="polite">
      {online ? 'Back online' : <><WifiSlash size={16} weight="bold" aria-hidden="true" /> You’re offline. Videos, search and saving will resume when you reconnect.</>}
    </div>
  );
}
