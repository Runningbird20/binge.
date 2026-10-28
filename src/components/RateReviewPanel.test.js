import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RateReviewPanel from './RateReviewPanel';

jest.mock('@phosphor-icons/react', () => ({ ArrowRight: () => null }));
jest.mock('./StarRating', () => function MockStars({ onChange }) {
  return <button onClick={() => onChange(4)}>Four stars</button>;
});
jest.mock('./RatingInput', () => function MockCategories({ onChange }) {
  return <button onClick={() => onChange({ acting: 3, writing: 4 })}>Save categories</button>;
});

test('removes text reviews and saves only rating categories', async () => {
  const onSave = jest.fn().mockResolvedValue(undefined);
  render(<RateReviewPanel mediaType="movie" value={{ review: 'Legacy text' }} onSave={onSave} />);
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByText('Legacy text')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Four stars'));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  expect(onSave.mock.calls[0]).toHaveLength(1);
  expect(onSave.mock.calls[0][0]).toEqual(expect.objectContaining({ acting: 4, writing: 4 }));
  fireEvent.click(screen.getByText('Rate in detail'));
  fireEvent.click(screen.getByText('Save categories'));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
  expect(onSave.mock.calls[1]).toEqual([{ acting: 3, writing: 4 }]);
});
