import { Plus } from '@phosphor-icons/react';
import ThemedSelect from './ThemedSelect';
import { STATUS_LABELS, getStatusOptions } from '../utils/watchlistStatus';

// Compact status control meant to sit on a poster tile / media card itself —
// a bare "+" pill when the item isn't saved yet, or a status dropdown once it
// is, so status can be changed without navigating to the watchlist page.
export default function WatchlistStatusControl({
  mediaType,
  status,
  onAdd,
  onChange,
  adding = false,
  className,
}) {
  // className, when passed, fully replaces (not appends to) the default
  // variant class — stacking both let each context's CSS bleed into the
  // other (e.g. the modal's light-pill background colliding with the poster
  // tile's dark-pill text color, leaving the label invisible until :hover
  // happened to flip the background).
  if (!status) {
    return (
      <button
        type="button"
        className={className || 'watchlist-status-add'}
        onClick={onAdd}
        disabled={adding}
        title="Add to library"
        aria-label="Add to library"
      >
        {/* SVG plus (not a "+" text glyph) so it's geometrically centered in
            the round button regardless of the font's plus-sign metrics. */}
        {adding ? '…' : <Plus size={15} weight="bold" />}
      </button>
    );
  }

  return (
    <ThemedSelect
      className={className || 'watchlist-status-select'}
      value={status}
      aria-label="Watchlist status"
      options={getStatusOptions(mediaType).map((value) => ({ value, label: STATUS_LABELS[value] }))}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
