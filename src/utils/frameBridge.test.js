import { inBingeApp, parseVtt, readFrameMessage } from './frameBridge';

test('only frames that answered this player\'s hello count', () => {
  expect(readFrameMessage({ type: 'binge-frame', nonce: 'abc', t: 12.5, d: 3600, paused: false }, 'abc'))
    .toEqual({ time: 12.5, duration: 3600, state: 'play', height: 0, ahead: 0 });
  expect(readFrameMessage({ type: 'binge-frame', nonce: 'old', t: 12.5 }, 'abc')).toBeNull();
  expect(readFrameMessage({ type: 'binge-frame', nonce: 'abc', t: 5, paused: true, ended: true }, 'abc').state).toBe('ended');
  expect(readFrameMessage({ type: 'other', nonce: 'abc', t: 5 }, 'abc')).toBeNull();
  expect(readFrameMessage({ type: 'binge-frame', nonce: 'abc', t: 'x' }, 'abc')).toBeNull();
});

test('VTT and SRT-style files parse into cues', () => {
  const cues = parseVtt('WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.500\n<i>Hello</i> &amp; welcome\n\n2\n00:01:00,000 --> 00:01:02,000 line:90%\nSecond\nline\n');
  expect(cues).toEqual([
    { start: 1, end: 2.5, text: 'Hello & welcome' },
    { start: 60, end: 62, text: 'Second\nline' },
  ]);
});

test('the bridge is only used inside the phone apps', () => {
  expect(inBingeApp()).toBe(false);
  jest.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Linux; Android 14) Chrome/150 Mobile Safari/537.36 BingeApp/1.0');
  expect(inBingeApp()).toBe(true);
});

test('the Android and iOS copies of the frame bridge are the same', () => {
  const fs = require('fs');
  const path = require('path');
  const root = path.resolve(__dirname, '../..');
  const android = fs.readFileSync(path.join(root, 'mobile-android/app/src/main/assets/frame-bridge.js'), 'utf8');
  const ios = fs.readFileSync(path.join(root, 'mobile-ios/BingeMobile/frame-bridge.js'), 'utf8');
  expect(ios).toBe(android);
  expect(android).toContain("m.type !== 'binge-frame-cmd'");
});
