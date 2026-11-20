import { createRuntimeWatch, formatLength, isWrongLength, lengthsAgree } from './runtimeCheck';

test('flags a video far from the real runtime', () => {
  expect(isWrongLength(5907, 9360)).toBe(true);   // Vidy's wrong video
  expect(isWrongLength(9233, 9360)).toBe(false);  // VidRift's cut
  expect(isWrongLength(2580, 2700)).toBe(false);  // an episode a little short
  expect(isWrongLength(1320, 2700)).toBe(true);   // a 22-min video for a 45-min episode
  expect(isWrongLength(0, 2700)).toBe(false);     // length not known yet
});

test('a guessed episode runtime gets a wider margin', () => {
  // A 70-minute finale in a season of 45-minute episodes, when TMDB has no
  // runtime for the finale itself.
  expect(isWrongLength(4200, { seconds: 2700, estimated: false })).toBe(true);
  expect(isWrongLength(4200, { seconds: 2700, estimated: true })).toBe(false);
  expect(isWrongLength(1260, { seconds: 2700, estimated: true })).toBe(true); // a 21-min video still is
  expect(isWrongLength(2820, { seconds: 1260, estimated: true })).toBe(true); // Vidy: 47 min for a 21-min episode
});

describe('waiting for a steady length', () => {
  const expected = { seconds: 9360, estimated: false };
  test("doesn't judge before 30s of playback or on one reading", () => {
    const watch = createRuntimeWatch();
    expect(watch.note({ duration: 95, time: 5, at: 0 }, expected)).toBeNull(); // a pre-roll's length
    expect(watch.note({ duration: 5907, time: 31, at: 1000 }, expected)).toBeNull(); // first steady reading
    expect(watch.note({ duration: 5907, time: 40, at: 6000 }, expected)).toBeNull(); // not 10s yet
    expect(watch.note({ duration: 5907, time: 45, at: 11500 }, expected)).toBe('wrong');
  });
  test('a length that is still growing starts the wait again', () => {
    const watch = createRuntimeWatch();
    watch.note({ duration: 3000, time: 35, at: 0 }, expected);
    expect(watch.note({ duration: 6000, time: 45, at: 11000 }, expected)).toBeNull();
    expect(watch.note({ duration: 9300, time: 50, at: 12000 }, expected)).toBeNull();
    expect(watch.note({ duration: 9300, time: 60, at: 23000 }, expected)).toBe('right');
  });
});

test('two servers with the same length agree; lengths read as a clock', () => {
  expect(lengthsAgree(8100, [8130])).toBe(true);
  expect(lengthsAgree(8100, [5907])).toBe(false);
  expect(formatLength(5907)).toBe('1h 38m');
  expect(formatLength(1320)).toBe('22 min');
});
