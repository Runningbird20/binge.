// "Hide scores": the setting, remembered per device, and the context cards and
// the player read it from.
import { createContext } from 'react';

export const HIDE_SCORES_KEY = 'binge.sports.hideScores';

// Spoiler-free mode (scores hidden everywhere on the page).
export const HideScores = createContext(false);

export function readHideScores() {
  try { return localStorage.getItem(HIDE_SCORES_KEY) === '1'; } catch { return false; }
}
