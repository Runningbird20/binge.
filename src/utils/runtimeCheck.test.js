import { isWrongLength } from './runtimeCheck';

test('flags a video far from the real runtime', () => {
  expect(isWrongLength(5907, 9360)).toBe(true);   // Vidy's wrong video
  expect(isWrongLength(9233, 9360)).toBe(false);  // VidRift's cut
  expect(isWrongLength(2580, 2700)).toBe(false);  // an episode a little short
  expect(isWrongLength(1320, 2700)).toBe(true);   // a 22-min video for a 45-min episode
  expect(isWrongLength(0, 2700)).toBe(false);     // length not known yet
});
