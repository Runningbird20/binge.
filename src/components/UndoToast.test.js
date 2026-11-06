import { act, fireEvent, render, screen } from '@testing-library/react';
import { toast } from 'sonner';
import { flushPendingRemovals, isRemovalPending, removeWithUndo } from './UndoToast';

jest.mock('sonner', () => {
  const fn = jest.fn();
  fn.custom = jest.fn();
  fn.dismiss = jest.fn();
  return { toast: fn, Toaster: () => null };
});

// A controllable clock for the countdown (frames and performance.now).
let now = 0;
let frames = [];
beforeEach(() => {
  jest.clearAllMocks();
  now = 0;
  frames = [];
  jest.spyOn(performance, 'now').mockImplementation(() => now);
  jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { frames.push(callback); return frames.length; });
  jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
});
afterEach(() => { flushPendingRemovals(); jest.restoreAllMocks(); });

function advance(ms, step = 250) {
  for (let t = 0; t < ms; t += step) {
    now += step;
    const at = now;
    const due = frames;
    frames = [];
    act(() => { due.forEach((callback) => callback(at)); });
  }
}

const flushPromises = () => act(() => Promise.resolve().then(() => Promise.resolve()));

function show(options = {}) {
  const onUndo = jest.fn();
  const onCommit = jest.fn().mockResolvedValue();
  const handle = removeWithUndo({ key: 'watchlist:1', message: 'Removed “Dune” from your library.', onUndo, onCommit, ...options });
  const [renderView, settings] = toast.custom.mock.calls[toast.custom.mock.calls.length - 1];
  render(renderView());
  return { onUndo, onCommit, handle, settings };
}

test('the removal happens when the 10 seconds run out, with the bar running down', async () => {
  const { onUndo, onCommit, settings } = show();
  expect(settings).toMatchObject({ toasterId: 'undo', duration: Infinity });
  expect(screen.getByRole('status')).toHaveTextContent('Removed “Dune” from your library.');
  expect(isRemovalPending('watchlist:1')).toBe(true);
  advance(5000);
  // The bar is decorative (aria-hidden), so no query finds it; its width is the check.
  // eslint-disable-next-line testing-library/no-node-access
  expect(document.querySelector('.undo-toast-bar').style.transform).toBe('scaleX(0.5)');
  expect(onCommit).not.toHaveBeenCalled();
  advance(5000);
  await flushPromises();
  expect(onCommit).toHaveBeenCalledTimes(1);
  expect(onUndo).not.toHaveBeenCalled();
  expect(toast.dismiss).toHaveBeenCalled();
  expect(isRemovalPending('watchlist:1')).toBe(false);
});

test('Undo puts it back and nothing is deleted', async () => {
  const { onUndo, onCommit, settings } = show();
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  expect(onUndo).toHaveBeenCalledTimes(1);
  // Sonner calls onDismiss as the popup goes: that must not delete it now.
  settings.onDismiss();
  advance(11000);
  await flushPromises();
  expect(onCommit).not.toHaveBeenCalled();
});

test('the countdown waits while the popup is hovered', async () => {
  const { onCommit } = show();
  fireEvent.mouseEnter(screen.getByRole('status'));
  advance(15000);
  await flushPromises();
  expect(onCommit).not.toHaveBeenCalled();
  fireEvent.mouseLeave(screen.getByRole('status'));
  advance(10000);
  await flushPromises();
  expect(onCommit).toHaveBeenCalledTimes(1);
});

test('dismissing, swiping it away or leaving the page carries the removal out at once', async () => {
  const first = show();
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  await flushPromises();
  expect(first.onCommit).toHaveBeenCalledTimes(1);

  const second = show({ key: 'continue:2' });
  second.settings.onDismiss();
  await flushPromises();
  expect(second.onCommit).toHaveBeenCalledTimes(1);

  const third = show({ key: 'history:tv_show:3' });
  flushPendingRemovals();
  await flushPromises();
  expect(third.onCommit).toHaveBeenCalledTimes(1);
});

test('if the delete fails, the item comes back and a notice says why', async () => {
  const { onUndo, handle } = show({ onCommit: jest.fn().mockRejectedValue(new Error('Unable to remove that library item.')) });
  handle.commit();
  await flushPromises();
  expect(onUndo).toHaveBeenCalledTimes(1);
  expect(toast).toHaveBeenCalledWith('Unable to remove that library item.', { description: 'It’s back where it was.' });
});
