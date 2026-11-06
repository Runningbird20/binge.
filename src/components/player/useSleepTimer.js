import { useEffect, useRef, useState } from 'react';

// The sleep timer, the same choices as the TV apps (PlayerModel.swift / .kt).
// "End of episode" is for series, on servers that report playback (it needs
// to see the episode end).
export const SLEEP_OPTIONS = [
  { id: 'off', label: 'Off' },
  { id: '15', label: '15 min', minutes: 15 },
  { id: '30', label: '30 min', minutes: 30 },
  { id: '60', label: '1 hour', minutes: 60 },
  { id: 'episode', label: 'End of episode' },
];

// Within this many seconds of the end counts as the end (VidRift reports the
// time only every 5s).
export const EPISODE_END_SECONDS = 5;

// Counts down and calls onSleep('timer' | 'episode') once, then turns itself
// off. Lasts as long as the player is open, across episodes.
export default function useSleepTimer({ isTV, canTellEnd, playbackRef, onSleep }) {
  const [choice, setChoice] = useState('off');
  const [until, setUntil] = useState(null);
  const [minutesLeft, setMinutesLeft] = useState(null);
  const onSleepRef = useRef(onSleep);
  onSleepRef.current = onSleep;

  const options = SLEEP_OPTIONS.filter((option) => option.id !== 'episode' || (isTV && canTellEnd));

  function choose(id) {
    const option = SLEEP_OPTIONS.find((entry) => entry.id === id) || SLEEP_OPTIONS[0];
    setChoice(option.id);
    setUntil(option.minutes ? Date.now() + option.minutes * 60000 : null);
    setMinutesLeft(option.minutes || null);
  }

  function fire(reason) {
    choose('off');
    onSleepRef.current(reason);
  }

  // A switch to a server that can't report playback can't see the episode end.
  useEffect(() => {
    if (choice !== 'episode' || (isTV && canTellEnd)) return;
    setChoice('off');
    setUntil(null);
    setMinutesLeft(null);
  }, [choice, isTV, canTellEnd]);

  useEffect(() => {
    if (!until) return undefined;
    const timer = setInterval(() => {
      const left = until - Date.now();
      if (left <= 0) fire('timer');
      else setMinutesLeft(Math.ceil(left / 60000));
    }, 1000);
    return () => clearInterval(timer);
    // fire only uses setters and a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [until]);

  useEffect(() => {
    if (choice !== 'episode') return undefined;
    const timer = setInterval(() => {
      const { time, duration, ended } = playbackRef.current;
      if (ended || (duration > 0 && time > 0 && duration - time <= EPISODE_END_SECONDS)) fire('episode');
    }, 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choice, playbackRef]);

  const label = choice === 'off' ? null
    : choice === 'episode' ? 'Stops after this episode'
      : `Stops in ${minutesLeft >= 60 ? '1 hour' : `${minutesLeft} min`}`;

  return { choice, options, choose, label, stopAfterEpisode: choice === 'episode', turnOff: () => choose('off') };
}
