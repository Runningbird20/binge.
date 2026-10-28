import { useSyncExternalStore } from 'react';
import { subscribeLoading, getLoadingProgress } from '../utils/loadingProgress';
import './LoadingBar.css';

export default function LoadingBar({ label = 'Loading…', compact = false, progress }) {
  const network = useSyncExternalStore(subscribeLoading, getLoadingProgress, getLoadingProgress);
  const measured = Number.isFinite(progress) ? progress : network.total ? network.completed / network.total * 100 : null;
  const percent = measured === null ? null : Math.round(Math.max(0, Math.min(100, measured)));
  return (
    <div className={`loading-bar-state${compact ? ' loading-bar-state--compact' : ''}`} role="status" aria-live="polite" aria-busy="true">
      <span className="loading-bar-label">{label}{percent !== null && <span className="loading-bar-percent"> {percent}%</span>}</span>
      <div className="loading-bar-track" role="progressbar" aria-label={label}
        aria-valuemin={percent === null ? undefined : 0} aria-valuemax={percent === null ? undefined : 100}
        aria-valuenow={percent === null ? undefined : percent}
        aria-valuetext={percent === null ? undefined : `${percent}% of current data requests completed`}>
        <span className={`loading-bar-fill${percent === null ? '' : ' loading-bar-fill--measured'}`} style={percent === null ? undefined : { width: `${percent}%` }} />
      </div>
    </div>
  );
}
