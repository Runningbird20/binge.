// End-to-end tests (Playwright) for the flows that matter most: sign up,
// play, resume, rate, the TV remote, history import and accessibility.
//
//   npm run test:e2e                 starts the app locally and runs them
//   E2E_BASE_URL=https://… npm run test:e2e   runs against a deployment
//
// Signed-in tests need a dedicated test account (never your real one):
//   E2E_EMAIL=… E2E_PASSWORD=…   (in .env or the environment)
// Without it they're skipped, and the signed-out tests still run.
const path = require('path');
const { defineConfig, devices } = require('@playwright/test');

require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3100';
const local = !process.env.E2E_BASE_URL;

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.js/ },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 }, storageState: 'e2e/.auth/user.json' },
      dependencies: ['setup'],
      testIgnore: /(auth\.setup|tv\.spec)\.js/,
    },
    {
      name: 'tv',
      use: {
        viewport: { width: 960, height: 540 },
        deviceScaleFactor: 2,
        userAgent: 'Mozilla/5.0 (Linux; Android 9; AFTMM) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 BingeTV/1.0',
        storageState: 'e2e/.auth/user.json',
      },
      dependencies: ['setup'],
      testMatch: /tv\.spec\.js/,
    },
  ],
  webServer: local ? [
    { command: 'node server/index.js', port: 5001, reuseExistingServer: true, env: { PORT: '5001' } },
    { command: 'npx react-scripts start', url: baseURL, reuseExistingServer: true, timeout: 180_000, env: { PORT: '3100', BROWSER: 'none' } },
  ] : undefined,
});
