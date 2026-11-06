import {
  formatClock,
  getPositionEntry,
  getResumePosition,
  mergeRemotePosition,
  positionKey,
  savePosition,
} from './playbackPositions';
import { setActiveProfileId } from './activeProfile';

const NOW = new Date('2026-06-10T12:00:00Z').getTime();

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  localStorage.clear();
  setActiveProfileId('profile-a');
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  setActiveProfileId(null);
});

describe('which place a saved position belongs to', () => {
  test('every episode of a series has its own place; a movie has one', () => {
    expect(positionKey('tv_show', 7, 2, 3)).toBe('tv:7:2:3');
    expect(positionKey('tv_show', 7, 2, 4)).not.toBe(positionKey('tv_show', 7, 2, 3));
    expect(positionKey('tv_show', 7, 3, 3)).not.toBe(positionKey('tv_show', 7, 2, 3));
    expect(positionKey('movie', 7)).toBe('movie:7');
    expect(positionKey('movie', 7, 1, 1)).toBe('movie:7');
    expect(positionKey('movie', 7)).not.toBe(positionKey('tv_show', 7, 1, 1));
  });

  test('episodes of the same series resume where each one was left', () => {
    savePosition(positionKey('tv_show', 7, 1, 1), 600, 2700);
    savePosition(positionKey('tv_show', 7, 1, 2), 1200, 2700);
    expect(getResumePosition(positionKey('tv_show', 7, 1, 1))).toBe(600);
    expect(getResumePosition(positionKey('tv_show', 7, 1, 2))).toBe(1200);
    expect(getResumePosition(positionKey('tv_show', 7, 1, 3))).toBeNull();
  });

  test('two profiles on one device keep separate places in the same episode', () => {
    const key = positionKey('tv_show', 7, 2, 3);
    setActiveProfileId('profile-a');
    savePosition(key, 600, 2700);

    setActiveProfileId('profile-b');
    expect(getResumePosition(key)).toBeNull();
    savePosition(key, 1500, 2700);
    expect(getResumePosition(key)).toBe(1500);

    setActiveProfileId('profile-a');
    expect(getResumePosition(key)).toBe(600);
  });

  test('with no profile picked yet, positions still save and resume', () => {
    setActiveProfileId(null);
    savePosition(positionKey('movie', 9), 400, 6000);
    expect(getResumePosition(positionKey('movie', 9))).toBe(400);

    setActiveProfileId('profile-a');
    expect(getResumePosition(positionKey('movie', 9))).toBeNull();
  });
});

describe('when there is something worth resuming', () => {
  const key = positionKey('movie', 1);

  test('nothing is offered for the first 30 seconds', () => {
    savePosition(key, 30, 6000);
    expect(getResumePosition(key)).toBeNull();
    savePosition(key, 31, 6000);
    expect(getResumePosition(key)).toBe(31);
  });

  test('nothing is offered within the last two minutes, when the length is known', () => {
    savePosition(key, 6000 - 119, 6000);
    expect(getResumePosition(key)).toBeNull();
    savePosition(key, 6000 - 120, 6000);
    expect(getResumePosition(key)).toBe(5880);
  });

  test('without a known length, any position past 30 seconds is offered', () => {
    savePosition(key, 5990);
    expect(getResumePosition(key)).toBe(5990);
  });

  test('a save without a length keeps the length already known, so the end still counts as finished', () => {
    savePosition(key, 600, 6000);
    savePosition(key, 5950);
    expect(getPositionEntry(key)).toMatchObject({ t: 5950, d: 6000 });
    expect(getResumePosition(key)).toBeNull();
  });

  test('positions are whole seconds', () => {
    savePosition(key, 615.9, 6000.7);
    expect(getPositionEntry(key)).toEqual({ t: 615, d: 6000, at: NOW });
    expect(getResumePosition(key)).toBe(615);
  });

  test('a zero or missing time never replaces a saved position', () => {
    savePosition(key, 900, 6000);
    savePosition(key, 0, 6000);
    savePosition(key, undefined, 6000);
    savePosition(key, Number.NaN, 6000);
    expect(getResumePosition(key)).toBe(900);
  });

  test('a title never played has nothing to resume', () => {
    expect(getResumePosition(key)).toBeNull();
    expect(getPositionEntry(key)).toBeNull();
  });
});

describe('how many positions a device keeps', () => {
  test('past 400 titles the one watched longest ago is forgotten, not the one just watched', () => {
    for (let i = 0; i < 400; i += 1) {
      jest.setSystemTime(NOW + i * 1000);
      savePosition(positionKey('movie', i), 100 + i);
    }
    // Rewatching the oldest makes it recent again.
    jest.setSystemTime(NOW + 400 * 1000);
    savePosition(positionKey('movie', 0), 500);
    jest.setSystemTime(NOW + 401 * 1000);
    savePosition(positionKey('movie', 400), 700);

    expect(getResumePosition(positionKey('movie', 0))).toBe(500);
    expect(getResumePosition(positionKey('movie', 1))).toBeNull();
    expect(getResumePosition(positionKey('movie', 2))).toBe(102);
    expect(getResumePosition(positionKey('movie', 400))).toBe(700);
    expect(Object.keys(JSON.parse(localStorage.getItem('binge:positions:profile-a')))).toHaveLength(400);
  });
});

describe('positions synced from another device', () => {
  const key = positionKey('tv_show', 7, 2, 3);

  test('a position from another device is adopted when this device has none', () => {
    expect(mergeRemotePosition(key, 1234.6, 2700, NOW - 5000)).toBe(true);
    expect(getPositionEntry(key)).toEqual({ t: 1234, d: 2700, at: NOW - 5000 });
    expect(getResumePosition(key)).toBe(1234);
  });

  test('a newer synced position replaces this device’s older one', () => {
    jest.setSystemTime(NOW - 60000);
    savePosition(key, 300, 2700);
    jest.setSystemTime(NOW);
    expect(mergeRemotePosition(key, 1800, 2700, NOW - 1000)).toBe(true);
    expect(getResumePosition(key)).toBe(1800);
  });

  test('an older synced position never overwrites where this device got to', () => {
    savePosition(key, 1800, 2700);
    expect(mergeRemotePosition(key, 300, 2700, NOW - 60000)).toBe(false);
    expect(getResumePosition(key)).toBe(1800);
  });

  test('on a tie, this device’s position wins', () => {
    savePosition(key, 1800, 2700);
    expect(mergeRemotePosition(key, 300, 2700, NOW)).toBe(false);
    expect(getResumePosition(key)).toBe(1800);
  });

  test('a synced position with no time stamp never beats a saved one', () => {
    savePosition(key, 1800, 2700);
    expect(mergeRemotePosition(key, 300, 2700, 0)).toBe(false);
    expect(mergeRemotePosition(key, 300, 2700, undefined)).toBe(false);
    expect(getResumePosition(key)).toBe(1800);
  });

  test('a synced position of zero is ignored', () => {
    expect(mergeRemotePosition(key, 0, 2700, NOW)).toBe(false);
    expect(mergeRemotePosition(key, null, 2700, NOW)).toBe(false);
    expect(getPositionEntry(key)).toBeNull();
  });

  test('a synced position without a length keeps the length this device knew', () => {
    jest.setSystemTime(NOW - 60000);
    savePosition(key, 300, 2700);
    expect(mergeRemotePosition(key, 2650, null, NOW)).toBe(true);
    expect(getPositionEntry(key)).toMatchObject({ t: 2650, d: 2700 });
    expect(getResumePosition(key)).toBeNull(); // within two minutes of the end
  });

  test('a synced position lands in the active profile only', () => {
    mergeRemotePosition(key, 900, 2700, NOW);
    setActiveProfileId('profile-b');
    expect(getResumePosition(key)).toBeNull();
  });
});

describe('when storage misbehaves', () => {
  test('a corrupted store reads as empty and the next save starts it again', () => {
    localStorage.setItem('binge:positions:profile-a', '{not json');
    expect(getResumePosition(positionKey('movie', 1))).toBeNull();
    savePosition(positionKey('movie', 1), 600, 6000);
    expect(getResumePosition(positionKey('movie', 1))).toBe(600);
  });

  test('a full or blocked storage doesn’t break playback', () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => savePosition(positionKey('movie', 1), 600, 6000)).not.toThrow();
    expect(() => mergeRemotePosition(positionKey('movie', 1), 600, 6000, NOW)).not.toThrow();
    expect(getResumePosition(positionKey('movie', 1))).toBeNull();
  });
});

describe('the clock shown on the player', () => {
  test('under an hour it reads minutes and seconds', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(9)).toBe('0:09');
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(23 * 60 + 14)).toBe('23:14');
    expect(formatClock(3599)).toBe('59:59');
  });

  test('from an hour it reads hours, minutes and seconds', () => {
    expect(formatClock(3600)).toBe('1:00:00');
    expect(formatClock(3725)).toBe('1:02:05');
    expect(formatClock(10 * 3600 + 59 * 60 + 59)).toBe('10:59:59');
  });

  test('fractions round down and nonsense reads as zero', () => {
    expect(formatClock(90.9)).toBe('1:30');
    expect(formatClock(-5)).toBe('0:00');
    expect(formatClock(undefined)).toBe('0:00');
    expect(formatClock(null)).toBe('0:00');
    expect(formatClock(Number.NaN)).toBe('0:00');
  });
});
