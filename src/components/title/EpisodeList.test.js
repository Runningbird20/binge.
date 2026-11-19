import { fireEvent, render, screen } from '@testing-library/react';
import { EpisodeList } from './EpisodeList';
import { getSettings } from '../../utils/profileSettings';

jest.mock('../../hooks/useTitleDetails', () => ({ useSeasonEpisodes: () => mockEpisodes }));
jest.mock('../../utils/profileSettings', () => ({ ...jest.requireActual('../../utils/profileSettings'), getSettings: jest.fn() }));

const episode = (number, title) => ({ number, title, overview: `What happens in ${title}.`, still: `/still${number}.jpg`, runtime: 50, airDate: '2022-02-18' });
const mockEpisodes = [episode(1, 'Good News About Hell'), episode(2, 'Half Loop'), episode(3, 'In Perpetuity')];

function renderList({ spoilerFree, watched = new Set(['1:1']), currentEpisode = 2 } = {}) {
  getSettings.mockReturnValue({ spoilerFree });
  render(
    <EpisodeList
      tmdbId={95396}
      seasons={[{ season_number: 1, name: 'Season 1', episode_count: 3 }]}
      watched={watched}
      currentSeason={currentEpisode ? 1 : null}
      currentEpisode={currentEpisode}
      onPlay={jest.fn()}
      onMark={jest.fn()}
      onUnmark={jest.fn()}
      busy={false}
      status={null}
    />,
  );
}

test('spoiler-free: an episode past your progress hides its summary until its eye shows it', () => {
  renderList({ spoilerFree: true });

  // Watched (1) and where you are (2) read as usual.
  expect(screen.getByText('What happens in Good News About Hell.')).toBeInTheDocument();
  expect(screen.getByText('What happens in Half Loop.')).toBeInTheDocument();
  // Episode 3 is ahead.
  expect(screen.queryByText('What happens in In Perpetuity.')).not.toBeInTheDocument();
  expect(screen.getByText('Summary hidden')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /^Show the picture and summary/ })).toHaveLength(1);

  const eye = screen.getByRole('button', { name: 'Show the picture and summary of episode 3' });
  expect(eye).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(eye);
  expect(screen.getByText('What happens in In Perpetuity.')).toHaveClass('td-episode-overview--revealed');
  expect(eye).toHaveAttribute('aria-pressed', 'true');
  // Only a revealed summary fades up; the ones that were never hidden don't.
  expect(screen.getByText('What happens in Half Loop.')).not.toHaveClass('td-episode-overview--revealed');

  fireEvent.click(eye); // and hidden again
  expect(screen.getByText('Summary hidden')).toBeInTheDocument();
});

test('a show not started yet: every episode is ahead', () => {
  renderList({ spoilerFree: true, watched: new Set(), currentEpisode: null });
  expect(screen.getAllByText('Summary hidden')).toHaveLength(3);
});

test('off (the default): every summary shows and there are no eye buttons', () => {
  renderList({ spoilerFree: false });
  expect(screen.getByText('What happens in In Perpetuity.')).toBeInTheDocument();
  expect(screen.queryByText('Summary hidden')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Show the picture and summary/ })).not.toBeInTheDocument();
});
