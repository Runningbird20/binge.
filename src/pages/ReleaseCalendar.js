import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CalendarPlus, CalendarBlank } from '@phosphor-icons/react';
import Navbar from '../components/Navbar';
import TitleRow from '../components/TitleRow';
import { exportToCalendar, loadReleaseCalendar } from '../utils/releaseCalendar';

function dayHeading(iso) {
  const date = new Date(`${iso}T12:00:00`);
  const today = new Date();
  const start = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((start(date) - start(today)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff < 7) return date.toLocaleDateString([], { weekday: 'long' });
  return date.toLocaleDateString([], { weekday: 'short', month: 'long', day: 'numeric', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

const KIND_LABEL = { episode: 'New episode', season: 'Season premiere', movie: 'Movie' };

export default function ReleaseCalendar() {
  const location = useLocation();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    loadReleaseCalendar()
      .then((result) => { if (!cancelled) setData(result); })
      .catch(() => { if (!cancelled) setError('Couldn’t load your calendar.'); });
    return () => { cancelled = true; };
  }, []);

  const groups = useMemo(() => {
    const map = new Map();
    (data?.events || []).forEach((event) => map.set(event.date, [...(map.get(event.date) || []), event]));
    return [...map.entries()];
  }, [data]);

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content cal-page">
        <header className="st-page-head">
          <div>
            <p className="st-page-kicker">Your shows & movies</p>
            <h1 className="st-page-title">Release Calendar</h1>
          </div>
          {data?.events?.length > 0 && (
            <button type="button" className="st-btn st-btn--primary" onClick={() => exportToCalendar(data.events)}>
              <CalendarPlus size={18} weight="bold" /> Add all to my calendar
            </button>
          )}
        </header>

        {!data && !error && <div className="cal-skeleton skeleton-block" aria-hidden="true" />}
        {error && <p className="hist-message" role="alert">{error}</p>}

        {data && data.events.length === 0 && (
          <div className="pf-empty">
            <CalendarBlank size={32} weight="duotone" />
            <p>Nothing scheduled yet. Add shows to My List and their next episodes will show up here.</p>
          </div>
        )}

        {groups.map(([date, events]) => (
          <section key={date} className="cal-day" aria-label={dayHeading(date)}>
            <h2 className="cal-day-title">{dayHeading(date)}</h2>
            <ul className="cal-list">
              {events.map((event) => (
                <li key={event.id} className={`cal-item cal-item--${event.kind}`}>
                  <Link to={event.url} state={{ backgroundLocation: location }} className="cal-poster" tabIndex={-1} aria-hidden="true">
                    {event.image ? <img src={event.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span>{event.title.charAt(0)}</span>}
                  </Link>
                  <div className="cal-body">
                    <span className="cal-kind">{KIND_LABEL[event.kind]}</span>
                    <Link to={event.url} state={{ backgroundLocation: location }} className="cal-title">{event.title}</Link>
                    <span className="cal-detail">{event.detail}</span>
                  </div>
                  <button type="button" className="pf-icon-btn" onClick={() => exportToCalendar([event], `${event.title.replace(/[^\w]+/g, '-')}.ics`)} aria-label={`Add ${event.title} to my calendar`} title="Add to my calendar">
                    <CalendarPlus size={18} weight="bold" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}

        {data?.renewed?.length > 0 && (
          <section className="cal-day" aria-label="Renewed">
            <h2 className="cal-day-title">Renewed — date not announced</h2>
            <ul className="cal-list">
              {data.renewed.map((entry) => (
                <li key={entry.id} className="cal-item">
                  <Link to={entry.url} state={{ backgroundLocation: location }} className="cal-poster" tabIndex={-1} aria-hidden="true">
                    {entry.image ? <img src={entry.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span>{entry.title.charAt(0)}</span>}
                  </Link>
                  <div className="cal-body">
                    <Link to={entry.url} state={{ backgroundLocation: location }} className="cal-title">{entry.title}</Link>
                    <span className="cal-detail">{entry.detail}</span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {data?.comingSoon?.length > 0 && (
          <TitleRow title="Coming soon to binge." subtitle="Not on your list yet" items={data.comingSoon} />
        )}
      </main>
    </div>
  );
}
