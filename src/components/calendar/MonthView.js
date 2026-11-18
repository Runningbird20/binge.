import { useMemo, useState } from 'react';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import ReleaseList, { dateOf, dayHeading } from './ReleaseList';
import { calendarMonths, eventsByDate, firstDayOfWeek, monthOf, monthWeeks } from '../../utils/releaseCalendar';
import { todayIso } from '../../utils/releaseWindow';

const CHIPS = 3; // releases drawn in a day's square; the rest are "+N more"

const monthName = (month, options = { month: 'long', year: 'numeric' }) => dateOf(`${month}-01`).toLocaleDateString([], options);

// Column heads from a known week (January 4, 2026 was a Sunday).
function weekdayNames(firstDay) {
  return Array.from({ length: 7 }, (_, column) => {
    const date = new Date(2026, 0, 4 + ((firstDay + column) % 7));
    return { short: date.toLocaleDateString([], { weekday: 'short' }), long: date.toLocaleDateString([], { weekday: 'long' }) };
  });
}

// "Wednesday, November 18: Severance, The Bear and 2 more"
function dayLabel(day, releases) {
  const titles = releases.slice(0, CHIPS).map((event) => event.title);
  const more = releases.length - titles.length;
  const date = dateOf(day).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  return `${date}: ${titles.join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
}

// "Today, November 18" / "Friday, November 20"
function panelHeading(day) {
  const relative = dayHeading(day);
  const date = dateOf(day);
  if (relative === 'Today' || relative === 'Tomorrow') return `${relative}, ${date.toLocaleDateString([], { month: 'long', day: 'numeric' })}`;
  return date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

const firstReleaseIn = (month, byDate) => [...byDate.keys()].find((day) => monthOf(day) === month) || null;

// The releases on a month grid, opening on the first month with one. Picking
// a day lists its releases beside the grid (below it on phones).
export default function MonthView({ events }) {
  const today = todayIso();
  const months = useMemo(() => calendarMonths(events, today), [events, today]);
  const byDate = useMemo(() => eventsByDate(events), [events]);
  const firstDay = useMemo(() => firstDayOfWeek(), []);
  const weekdays = useMemo(() => weekdayNames(firstDay), [firstDay]);
  const [month, setMonth] = useState(() => monthOf(events[0]?.date || today));
  const [picked, setPicked] = useState(null);

  // Derived, so a reload with other events can't leave a stale month or day.
  const shown = months.includes(month) ? month : months[0];
  const selected = picked && byDate.has(picked) && monthOf(picked) === shown ? picked : firstReleaseIn(shown, byDate);
  const index = months.indexOf(shown);
  const weeks = useMemo(() => monthWeeks(shown, firstDay), [shown, firstDay]);
  const nextRelease = selected ? null : [...byDate.keys()].find((day) => monthOf(day) > shown);

  function go(target) {
    setMonth(target);
    setPicked(null);
  }

  return (
    <div className="cal-month">
      <section className="cal-month-main" aria-labelledby="cal-month-title">
        <div className="cal-month-head">
          <h2 id="cal-month-title" className="cal-month-title" aria-live="polite">{monthName(shown)}</h2>
          <div className="cal-month-nav">
            <button type="button" className="pf-icon-btn" onClick={() => go(months[index - 1])} disabled={index <= 0} aria-label="Previous month">
              <CaretLeft size={20} weight="bold" />
            </button>
            <button type="button" className="pf-icon-btn" onClick={() => go(months[index + 1])} disabled={index >= months.length - 1} aria-label="Next month">
              <CaretRight size={20} weight="bold" />
            </button>
          </div>
        </div>

        <div className="cal-grid">
          {weekdays.map((name) => (
            <span key={name.long} className="cal-weekday" aria-hidden="true">{name.short}</span>
          ))}
          {weeks.flat().map((day, position) => {
            if (!day) return <div key={`out-${position}`} className="cal-cell cal-cell--out" aria-hidden="true" />;
            const releases = byDate.get(day);
            const classes = `cal-cell${day < today ? ' cal-cell--past' : ''}${day === today ? ' cal-cell--today' : ''}`;
            const number = Number(day.slice(8));
            if (!releases) return <div key={day} className={classes}><span className="cal-num">{number}</span></div>;
            const isSelected = day === selected;
            return (
              <div key={day} className={`${classes} cal-cell--has`}>
                <button
                  type="button"
                  className={`cal-day-btn${isSelected ? ' selected' : ''}`}
                  aria-pressed={isSelected}
                  aria-label={dayLabel(day, releases)}
                  onClick={() => setPicked(day)}
                >
                  <span className="cal-num">{number}</span>
                  <span className="cal-chips">
                    {releases.slice(0, CHIPS).map((event) => (
                      <span key={event.id} className="cal-chip">
                        {event.image ? <img src={event.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="cal-chip-art" />}
                        <span className="cal-chip-title">{event.title}</span>
                      </span>
                    ))}
                    {releases.length > CHIPS && <span className="cal-chip-more">+{releases.length - CHIPS} more</span>}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <section className="cal-month-day" aria-labelledby="cal-month-day-title">
        {selected ? (
          <>
            <h3 id="cal-month-day-title" className="cal-day-title">{panelHeading(selected)}</h3>
            <ReleaseList entries={byDate.get(selected)} />
          </>
        ) : (
          <>
            <h3 id="cal-month-day-title" className="cal-day-title">{`Nothing in ${monthName(shown, { month: 'long' })}`}</h3>
            <p className="cal-month-empty">
              {nextRelease ? 'None of your shows or movies have a release this month.' : 'No more releases are scheduled yet.'}
            </p>
            {nextRelease && (
              <button type="button" className="st-btn st-btn--ghost" onClick={() => go(monthOf(nextRelease))}>
                Next release: {monthName(monthOf(nextRelease))} <CaretRight size={16} weight="bold" />
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
}
