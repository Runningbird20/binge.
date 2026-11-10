import { useEffect, useState } from 'react';

// Sleep timer (the TV apps have one). The website can't pause another
// site's player, so when the time is up the player closes, which saves your
// position like closing it yourself. 'episode' closes it at the end of this
// episode instead of moving on (useUpNext's stopAtEnd).
export const SLEEP_CHOICES = [
  { value: '', label: 'Off' },
  { value: '15', label: '15 minutes' },
  { value: '30', label: '30 minutes' },
  { value: '60', label: '1 hour' },
  { value: 'episode', label: 'End of episode' },
];

export default function useSleepTimer({ onClose, isTV }) {
  const [choice, setChoice] = useState('');
  const [endsAt, setEndsAt] = useState(null);

  useEffect(() => {
    const minutes = Number(choice);
    setEndsAt(minutes > 0 ? Date.now() + minutes * 60_000 : null);
  }, [choice]);

  useEffect(() => {
    if (!endsAt) return undefined;
    const timer = setTimeout(() => onClose?.(), Math.max(0, endsAt - Date.now()));
    return () => clearTimeout(timer);
  }, [endsAt, onClose]);

  return {
    choice,
    choices: SLEEP_CHOICES.filter((option) => option.value !== 'episode' || isTV),
    setChoice,
    endsAt,
    stopAtEnd: choice === 'episode',
  };
}
