import LoadingBar from './LoadingBar';

export function SkeletonCard() {
  return <LoadingBar compact label="Loading title…" />;
}

export function SkeletonGrid() {
  return <LoadingBar label="Loading titles…" />;
}
