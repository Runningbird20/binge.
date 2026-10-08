import { pickNext } from './KeyboardShortcuts';

jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }), { virtual: true });

const rect = (left, top, width = 100, height = 150) => ({ left, top, width, height });
const card = (name, r) => ({ el: name, rect: r });

describe('pickNext (arrow-key navigation)', () => {
  const from = rect(100, 100);
  const cards = [
    card('right', rect(210, 100)),
    card('farRight', rect(320, 100)),
    card('left', rect(-10, 100)),
    card('below', rect(110, 300)),
    card('belowFar', rect(400, 300)),
    card('above', rect(100, -100)),
  ];

  it('moves within the row for left/right', () => {
    expect(pickNext(from, cards, { x: 1, y: 0 })).toBe('right');
    expect(pickNext(from, cards, { x: -1, y: 0 })).toBe('left');
  });

  it('moves to the closest card in the next row for up/down', () => {
    expect(pickNext(from, cards, { x: 0, y: 1 })).toBe('below');
    expect(pickNext(from, cards, { x: 0, y: -1 })).toBe('above');
  });

  it('does not jump rows on left/right', () => {
    expect(pickNext(from, [card('below', rect(210, 300))], { x: 1, y: 0 })).toBeNull();
  });
});
