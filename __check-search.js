const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto('http://localhost:3000/ui-preview?page=movies', { waitUntil: 'networkidle' });
  await page.waitForSelector('.global-search-trigger', { timeout: 15000 });
  await page.screenshot({ path: '/tmp/search-closed.png' });

  await page.click('.global-search-trigger');
  await page.waitForSelector('.global-search-modal', { timeout: 5000 });
  await page.waitForTimeout(400); // let the rollout animation finish
  await page.screenshot({ path: '/tmp/search-open.png' });

  await page.fill('.global-search-input', 'dune');
  await page.waitForTimeout(600);
  await page.screenshot({ path: '/tmp/search-typed.png' });

  // click outside to verify the scrim closes it
  await page.mouse.click(50, 50);
  await page.waitForTimeout(200);
  const stillOpen = await page.$('.global-search-modal');
  await page.screenshot({ path: '/tmp/search-after-outside-click.png' });

  console.log('MODAL_AFTER_OUTSIDE_CLICK:', stillOpen ? 'STILL OPEN (bug)' : 'CLOSED (correct)');
  console.log('CONSOLE_ERRORS:', JSON.stringify(errors));

  await browser.close();
})();
