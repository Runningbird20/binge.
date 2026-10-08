// Light vibration feedback on key actions (play, add to list, rate…).
// Uses the Vibration API, which Android browsers support; iPhones don't
// expose it to web apps, so this is a silent no-op there.
import { getSettings } from './profileSettings';

const PATTERNS = { light: 10, medium: 18, success: [12, 40, 12], warning: [30, 50, 30] };

// Phones/tablets only — desktop Chrome has navigator.vibrate but no motor.
export function hapticsSupported() {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
    && typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)').matches);
}

export function haptic(kind = 'light') {
  if (!hapticsSupported() || !getSettings().haptics) return;
  try { navigator.vibrate(PATTERNS[kind] || PATTERNS.light); } catch { /* blocked */ }
}
