import { RETRY_AFTER_MS, forgetRefusal, rememberRefusal, shouldSandbox } from './popupSandbox';

function memoryStorage() {
  const data = new Map();
  return { getItem: (key) => (data.has(key) ? data.get(key) : null), setItem: (key, value) => data.set(key, String(value)) };
}

test('servers are sandboxed unless testing showed they refuse it', () => {
  const storage = memoryStorage();
  expect(shouldSandbox('vidrift', true, { storage })).toBe(true);
  expect(shouldSandbox('vidrift', undefined, { storage })).toBe(true); // untested: try it
  expect(shouldSandbox('2embed', false, { storage })).toBe(false);
  expect(shouldSandbox('', true, { storage })).toBe(false);
});

test('a refusal learned on this device lasts 14 days, then the sandbox is tried again', () => {
  const storage = memoryStorage();
  rememberRefusal('vidy', { storage, now: 1000 });
  expect(shouldSandbox('vidy', true, { storage, now: 1000 + RETRY_AFTER_MS - 1 })).toBe(false);
  expect(shouldSandbox('vidy', true, { storage, now: 1000 + RETRY_AFTER_MS })).toBe(true);
  expect(shouldSandbox('vidrift', true, { storage, now: 2000 })).toBe(true); // only that server
  forgetRefusal('vidy', { storage });
  expect(shouldSandbox('vidy', true, { storage, now: 2000 })).toBe(true);
});

test('blocked or broken storage just means "sandbox it"', () => {
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  expect(() => rememberRefusal('vidy', { storage: broken })).not.toThrow();
  expect(shouldSandbox('vidy', true, { storage: broken })).toBe(true);
  expect(shouldSandbox('vidy', true, { storage: { getItem: () => 'not json', setItem() {} } })).toBe(true);
});
