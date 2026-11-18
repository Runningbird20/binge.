import { Link, useLocation } from 'react-router-dom';
import { CalendarPlus } from '@phosphor-icons/react';
import { exportToCalendar } from '../../utils/releaseCalendar';

export const dateOf = (iso) => new Date(`${iso}T12:00:00`);

// "Today", "Tomorrow", a weekday this week, else the date.
export function dayHeading(iso) {
  const date = dateOf(iso);
  const today = new Date();
  const start = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((start(date) - start(today)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff < 7) return date.toLocaleDateString([], { weekday: 'long' });
  return date.toLocaleDateString([], { weekday: 'short', month: 'long', day: 'numeric', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

const KIND_LABEL = { episode: 'New episode', season: 'Season premiere', series: 'New series', movie: 'Movie' };

// Releases (or renewed shows, which have no date or kind), each linking to
// its title. Dated ones get their own "add to my calendar" button.
export default function ReleaseList({ entries }) {
  const location = useLocation();
  return (
    <ul className="cal-list">
      {entries.map((entry) => (
        <li key={entry.id} className={`cal-item${entry.kind ? ` cal-item--${entry.kind}` : ''}`}>
          <Link to={entry.url} state={{ backgroundLocation: location }} className="cal-poster" tabIndex={-1} aria-hidden="true">
            {entry.image ? <img src={entry.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span>{entry.title.charAt(0)}</span>}
          </Link>
          <div className="cal-body">
            {entry.kind && <span className="cal-kind">{KIND_LABEL[entry.kind]}</span>}
            <Link to={entry.url} state={{ backgroundLocation: location }} className="cal-title">{entry.title}</Link>
            <span className="cal-detail">{entry.detail}</span>
          </div>
          {entry.date && (
            <button type="button" className="pf-icon-btn" onClick={() => exportToCalendar([entry], `${entry.title.replace(/[^\w]+/g, '-')}.ics`)} aria-label={`Add ${entry.title} to my calendar`} title="Add to my calendar">
              <CalendarPlus size={18} weight="bold" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
