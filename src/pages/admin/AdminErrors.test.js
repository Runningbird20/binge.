import { fireEvent, render, screen } from '@testing-library/react';
import AdminErrors from './AdminErrors';

jest.mock('../../utils/supabase', () => {
  const at = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  const request = (ids) => `GET /api/catalog/rest/tv_shows?select=id%2Ctitle%2Cyear%2Cgenre%2Coverview&source_key=in.%28${ids.map((id) => `%22tmdb%3Atv%3A${id}%22`).join('%2C')}%29`;
  const rows = [
    { id: 2, created_at: at, source: 'server', fingerprint: 'slow-tv', message: 'Slow catalog query: select tv_shows (over 2s)', stack: 'select tv_shows, 2.4s\nwhere source_key.in', url: request([323026, 61431, 8988, 252]), resolved: false },
    { id: 1, created_at: at, source: 'server', fingerprint: 'slow-tv', message: 'Slow catalog query: select tv_shows (over 2s)', stack: 'select tv_shows, 2.1s\nwhere source_key.in', url: request([61025]), resolved: false },
  ];
  const query = {
    select: () => query, gte: () => query, order: () => query, limit: () => query, eq: () => query,
    then: (resolve) => Promise.resolve({ data: rows }).then(resolve),
  };
  return { supabase: { from: () => query } };
});

test('each request it came from is summed up on its own line, decoded', async () => {
  render(<AdminErrors />);
  expect(await screen.findByText('Slow catalog query: select tv_shows (over 2s)')).toBeInTheDocument();
  expect(screen.getByRole('list', { name: 'Requests' })).toBeInTheDocument();
  expect(screen.getByText('5 columns · source_key in 4 values (tmdb:tv:323026, tmdb:tv:61431, tmdb:tv:8988, …)')).toBeInTheDocument();
  expect(screen.getByText('5 columns · source_key in 1 value (tmdb:tv:61025)')).toBeInTheDocument();
  expect(screen.queryByText(/%2C|%22/)).toBeNull();
});

test('opening it shows the whole requests, decoded', async () => {
  render(<AdminErrors />);
  fireEvent.click(await screen.findByRole('button', { name: /Slow catalog query/ }));
  expect(screen.getByText(/source_key=in\.\("tmdb:tv:323026","tmdb:tv:61431"/)).toBeInTheDocument();
});
