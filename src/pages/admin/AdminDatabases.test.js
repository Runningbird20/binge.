import { fireEvent, render, screen } from '@testing-library/react';
import AdminDatabases, { formatBytes } from './AdminDatabases';
import { api } from '../../api';

jest.mock('../../api', () => ({ api: { get: jest.fn() } }));

const MB = 1024 ** 2;
const GB = 1024 ** 3;
const REPORT = {
  checkedAt: new Date().toISOString(),
  supabase: {
    status: 'slow',
    plan: { id: 'free', label: 'Free', source: 'default' },
    checks: [
      { id: 'database', label: 'Database', status: 'up', ms: 218, detail: '22 accounts' },
      { id: 'auth', label: 'Sign-in (Auth)', status: 'up', ms: 162, detail: 'Auth v2.198.0' },
      { id: 'storage', label: 'File storage', status: 'slow', ms: 2400, detail: '1 bucket' },
    ],
    usage: [
      { id: 'database', label: 'Database', unit: 'bytes', used: 48 * MB, limit: 500 * MB },
      { id: 'storage', label: 'File storage', unit: 'bytes', used: 12 * MB, limit: GB, detail: '31 files' },
    ],
    tables: [{ name: 'continue_watching', bytes: 9 * MB, rows: 4210 }],
    notes: [],
  },
  turso: {
    status: 'up',
    host: 'binge-catalog-me.aws-us-east-1.turso.io',
    plan: { id: 'free', label: 'Free', source: 'turso' },
    checks: [{ id: 'query', label: 'Catalog queries', status: 'up', ms: 261, detail: 'SQLite 3.47.0 · 35 tables' }],
    usage: [
      { id: 'storage', label: 'Storage', unit: 'bytes', used: 4.6 * GB, limit: 5 * GB },
      { id: 'reads', label: 'Rows read this month', unit: 'count', used: 120e6, limit: 500e6 },
      { id: 'writes', label: 'Rows written this month', unit: 'count', used: 2.4e6, limit: null },
    ],
    rows: [{ name: 'Movies', rows: 198481, updatedAt: new Date().toISOString() }],
    notes: ['Rows read and written this month (what Turso bills) show up once TURSO_PLATFORM_TOKEN and TURSO_ORG are set on the server.'],
  },
};

beforeEach(() => {
  api.get.mockReset().mockResolvedValue(REPORT);
});

test('it checks both databases when the tab opens', async () => {
  render(<AdminDatabases />);
  expect(await screen.findByRole('heading', { name: /Supabase/ })).toHaveTextContent('Slow');
  expect(screen.getByRole('heading', { name: /Turso/ })).toHaveTextContent('Healthy');
  expect(api.get).toHaveBeenCalledWith('/ops/databases');
  expect(screen.getByRole('row', { name: /File storage slow 2\.4 s 1 bucket/ })).toBeInTheDocument();
  expect(screen.getByText(/Free plan \(assumed\)/)).toBeInTheDocument();
});

test('how full each one is: a meter per limit, with the figure', async () => {
  render(<AdminDatabases />);
  expect(await screen.findByRole('meter', { name: 'Database' })).toHaveAttribute('aria-valuetext', '48 MB of 500 MB, 9.6%');
  expect(screen.getByRole('meter', { name: 'Rows read this month' })).toHaveAttribute('aria-valuetext', '120M of 500M, 24%');
  // A limit nobody knows is shown as the figure alone.
  expect(screen.queryByRole('meter', { name: 'Rows written this month' })).toBeNull();
  expect(screen.getByText(/plan limit unknown/)).toBeInTheDocument();
});

test('near the limit, the row says so in words', async () => {
  render(<AdminDatabases />);
  expect(await screen.findByRole('meter', { name: 'Storage' })).toHaveAttribute('aria-valuetext', '4.6 GB of 5 GB, 92%, almost full');
  expect(screen.getByText('Almost full')).toBeInTheDocument();
  expect(screen.getByRole('meter', { name: 'Database' })).toHaveAttribute('aria-valuetext', '48 MB of 500 MB, 9.6%');
});

test('what isn’t set up yet is explained, and Check again checks again', async () => {
  render(<AdminDatabases />);
  expect(await screen.findByText(/TURSO_PLATFORM_TOKEN and TURSO_ORG/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
  expect(await screen.findByRole('button', { name: 'Check again' })).toBeEnabled();
  expect(api.get).toHaveBeenCalledTimes(2);
});

test('when the server can’t be asked, it says why', async () => {
  api.get.mockRejectedValue(new Error('Admin access required'));
  render(<AdminDatabases />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t check the databases: Admin access required');
});

test('sizes read like a dashboard', () => {
  expect(formatBytes(477634560)).toBe('456 MB');
  expect(formatBytes(9.5 * MB)).toBe('9.5 MB');
  expect(formatBytes(512 * 1024)).toBe('512 KB');
  expect(formatBytes(5 * GB)).toBe('5 GB');
  expect(formatBytes(4.6 * GB)).toBe('4.6 GB');
});
