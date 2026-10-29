// The browser walkthrough (web-journey.spec.js) in Chrome and WebKit (Safari's
// engine), laptop and phone. Runs against production unless E2E_BASE_URL is set.
// Chrome is the installed Google Chrome: Playwright's own Chromium can't
// decode H.264, which nearly every stream uses. Chrome's autoplay is opened
// all the way (the policy a site you use often gets), the case where a
// hidden player could be heard.
const path = require('path');
const { defineConfig, devices } = require('@playwright/test');

// E2E_EMAIL / E2E_PASSWORD (a test account) and the Supabase keys come from .env.
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

const chromeArgs = ['--autoplay-policy=no-user-gesture-required'];

module.exports = defineConfig({
  testDir: __dirname,
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: process.env.E2E_BASE_URL || 'https://binge-26.vercel.app', trace: 'retain-on-failure' },
  projects: [
    { name: 'chrome-laptop', use: { channel: 'chrome', viewport: { width: 1440, height: 900 }, launchOptions: { args: chromeArgs } } },
    { name: 'safari-laptop', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } },
    { name: 'chrome-phone', use: { ...devices['Pixel 7'], channel: 'chrome', launchOptions: { args: chromeArgs } } },
    { name: 'safari-phone', use: { ...devices['iPhone 15'] } },
  ],
});
