import { buildIcs } from './releaseCalendar';

test('an .ics file with one all-day event per release', () => {
  const ics = buildIcs([
    { id: 'tv:1:2:3', date: '2026-11-20', title: 'Severance', detail: 'S2:E3, "Who Is Alive?"', url: '/tv-show/1' },
  ], 'https://binge.example');
  expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
  expect(ics).toContain('DTSTART;VALUE=DATE:20261120');
  expect(ics).toContain('DTEND;VALUE=DATE:20261121');
  expect(ics).toContain('URL:https://binge.example/tv-show/1');
  expect(ics).toMatch(/SUMMARY:Severance: S2:E3\\, "Who Is Alive\?"/);
  expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
});

test('a month-end release ends the next day in the next month', () => {
  const ics = buildIcs([{ id: 'm', date: '2026-12-31', title: 'X', detail: 'Out', url: '/movie/1' }], 'https://b');
  expect(ics).toContain('DTEND;VALUE=DATE:20270101');
});
