import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProfileSecurityDialog from './ProfileSecurityDialog';
import * as supabaseModule from '../utils/supabase';

const profile = { id: 'p1', name: 'Kids' };
const boxes = () => screen.getAllByLabelText(/digit \d of 4/i);

function setup(verifies) {
  const rpc = jest.fn().mockResolvedValue({ data: verifies, error: null });
  jest.spyOn(supabaseModule, 'requireSupabaseClient').mockReturnValue({ rpc });
  const onUnlock = jest.fn();
  const onCancel = jest.fn();
  render(<ProfileSecurityDialog profile={profile} editing={false} onUnlock={onUnlock} onCancel={onCancel} />);
  return { rpc, onUnlock, onCancel };
}

afterEach(() => jest.restoreAllMocks());

test('typing moves through the boxes and submits on the fourth digit', async () => {
  const { rpc, onUnlock } = setup(true);
  expect(screen.getByRole('heading', { name: /enter your pin to access this profile/i })).toBeInTheDocument();
  expect(boxes()[0]).toHaveFocus();
  '1234'.split('').forEach((d, i) => fireEvent.change(boxes()[i], { target: { value: d } }));
  await waitFor(() => expect(onUnlock).toHaveBeenCalled());
  expect(rpc).toHaveBeenCalledWith('verify_profile_pin', { target_profile: 'p1', entered_pin: '1234' });
});

test('Backspace on an empty box clears and returns to the previous one', () => {
  setup(true);
  fireEvent.change(boxes()[0], { target: { value: '7' } });
  expect(boxes()[1]).toHaveFocus();
  fireEvent.keyDown(boxes()[1], { key: 'Backspace' });
  expect(boxes()[0]).toHaveFocus();
  expect(boxes()[0]).toHaveValue('');
});

test('pasting a PIN fills every box', async () => {
  const { rpc } = setup(true);
  fireEvent.paste(boxes()[0], { clipboardData: { getData: () => '98 76' } });
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('verify_profile_pin', { target_profile: 'p1', entered_pin: '9876' }));
});

test('a wrong PIN shows an error and clears the boxes', async () => {
  const { onUnlock } = setup(false);
  fireEvent.paste(boxes()[0], { clipboardData: { getData: () => '0000' } });
  expect(await screen.findByText(/incorrect pin/i)).toHaveAttribute('role', 'alert');
  boxes().forEach((box) => expect(box).toHaveValue(''));
  expect(onUnlock).not.toHaveBeenCalled();
});

test('the close button and Escape go back to the profiles', () => {
  const { onCancel } = setup(true);
  fireEvent.click(screen.getByRole('button', { name: /back to profiles/i }));
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(onCancel).toHaveBeenCalledTimes(2);
});
