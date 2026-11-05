import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DownloadDataButton from './DownloadDataButton';
import { downloadMyData } from '../utils/dataExport';

jest.mock('../utils/dataExport', () => ({ downloadMyData: jest.fn() }));

afterEach(() => jest.clearAllMocks());

test('downloads the profile’s data and says what was in it', async () => {
  let finish;
  downloadMyData.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  render(<DownloadDataButton profileName="Cristal" />);

  await userEvent.click(screen.getByRole('button', { name: /download my data/i }));
  expect(downloadMyData).toHaveBeenCalledWith({ profileName: 'Cristal' });
  expect(screen.getByRole('button', { name: /preparing your data/i })).toBeDisabled();

  finish({ filename: 'binge-export-cristal-2026-11-05.zip', summary: '12 ratings · 30 on My List · 8 in history · 140 episodes' });
  expect(await screen.findByRole('status')).toHaveTextContent('Downloaded 12 ratings · 30 on My List · 8 in history · 140 episodes.');
  expect(screen.getByRole('button', { name: /download my data/i })).toBeEnabled();
});

test('shows why a download failed and lets you try again', async () => {
  downloadMyData.mockRejectedValue(new Error('Couldn’t read your ratings. Try again in a moment.'));
  render(<DownloadDataButton profileName="Cristal" />);

  await userEvent.click(screen.getByRole('button', { name: /download my data/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t read your ratings.');
  expect(screen.getByRole('button', { name: /download my data/i })).toBeEnabled();
});
