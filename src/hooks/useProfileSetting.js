import { useEffect, useState } from 'react';
import { getSettings, SETTINGS_EVENT } from '../utils/profileSettings';

// One of the active profile's settings (utils/profileSettings.js), kept
// current when it changes: in Settings, on a profile switch, or when the
// profile's own copy loads after the page has opened.
export default function useProfileSetting(name) {
  const [value, setValue] = useState(() => getSettings()[name]);
  useEffect(() => {
    const update = () => setValue(getSettings()[name]);
    update();
    window.addEventListener(SETTINGS_EVENT, update);
    return () => window.removeEventListener(SETTINGS_EVENT, update);
  }, [name]);
  return value;
}
