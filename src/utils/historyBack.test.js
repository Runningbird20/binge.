import { goBackTo, historyMark } from './historyBack';

afterEach(() => {
  delete window.navigation;
  jest.restoreAllMocks();
});

test('with the Navigation API: straight to the page the popup was opened from, past the player’s entries', () => {
  const entries = [{ key: 'home', index: 0 }, { key: 'popup', index: 1 }];
  const traverseTo = jest.fn(() => ({ committed: Promise.resolve(), finished: Promise.resolve() }));
  window.navigation = { currentEntry: entries[1], entries: () => entries, traverseTo };
  const mark = historyMark();
  expect(mark.originKey).toBe('home');
  const go = jest.spyOn(window.history, 'go').mockImplementation(() => {});
  goBackTo(mark);
  expect(traverseTo).toHaveBeenCalledWith('home');
  expect(go).not.toHaveBeenCalled();
});

test('without it: back past every entry added since the popup opened', () => {
  const length = jest.spyOn(window.history, 'length', 'get').mockReturnValue(4);
  const mark = historyMark();
  expect(mark).toEqual({ originKey: null, length: 4 });
  const go = jest.spyOn(window.history, 'go').mockImplementation(() => {});
  goBackTo(mark);
  expect(go).toHaveBeenLastCalledWith(-1);
  length.mockReturnValue(7); // the player's iframe added three
  goBackTo(mark);
  expect(go).toHaveBeenLastCalledWith(-4);
});
