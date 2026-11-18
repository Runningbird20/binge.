import LoadingBar from '../components/LoadingBar';
import { useEffect, useMemo, useState } from 'react';
import { CalendarPlus } from '@phosphor-icons/react';
import Navbar from '../components/Navbar';
import MonthView from '../components/calendar/MonthView';
import ReleaseList, { dayHeading } from '../components/calendar/ReleaseList';
import { eventsByDate, exportToCalendar, loadReleaseCalendar } from '../utils/releaseCalendar';
import useProfileSetting from '../hooks/useProfileSetting';
import { maturityRestriction } from '../utils/kidsMode';
import { useAuth } from '../contexts/AuthContext';

export default function ReleaseCalendar() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const kidsSafe = maturityRestriction(useAuth()?.activeProfile);
  // Month grid by default; Settings › Browsing switches the profile to a list.
  const listView = Boolean(useProfileSetting('calendarList'));

  useEffect(() => {
    let cancelled = false;
    loadReleaseCalendar({ kidsSafe })
      .then((result) => { if (!cancelled) setData(result); })
      .catch(() => { if (!cancelled) setError('Couldn’t load the calendar.'); });
    return () => { cancelled = true; };
  }, [kidsSafe]);

  const groups = useMemo(() => [...eventsByDate(data?.events || []).entries()], [data]);
  const hasEvents = data?.events?.length > 0;
  // Your phone calendar gets your releases; anything else has its own button.
  const mine = useMemo(() => (data?.events || []).filter((event) => event.mine), [data]);

  return (
    <div className="app-layout">
      <Navbar />
      <main className={`page-content cal-page${listView ? '' : ' cal-page--month'}`}>
        <header className="st-page-head">
          <div>
            <h1 className="st-page-title">Release Calendar</h1>
            <p className="st-page-sub">What’s coming to binge., with your shows’ new episodes first.</p>
          </div>
          {mine.length > 0 && (
            <button type="button" className="st-btn st-btn--primary" onClick={() => exportToCalendar(mine)}>
              <CalendarPlus size={18} weight="bold" /> Add my releases to my calendar
            </button>
          )}
        </header>

        {!data && !error && <LoadingBar />}
        {error && <p className="hist-message" role="alert">{error}</p>}

        {data && !listView && <MonthView events={data.events} />}

        {data && listView && !hasEvents && <p className="cal-month-empty">No releases are scheduled yet.</p>}

        {listView && groups.map(([date, events]) => (
          <section key={date} className="cal-day" aria-label={dayHeading(date)}>
            <h2 className="cal-day-title">{dayHeading(date)}</h2>
            <ReleaseList entries={events} />
          </section>
        ))}

        {data?.renewed?.length > 0 && (
          <section className="cal-day" aria-label="Renewed">
            <h2 className="cal-day-title">Renewed — date not announced</h2>
            <ReleaseList entries={data.renewed} />
          </section>
        )}
      </main>
    </div>
  );
}
