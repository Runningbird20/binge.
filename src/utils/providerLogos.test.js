import { contrast, displaySize, removeCaptions, removeTile, tileBackground } from './providerLogos';

test('logos are sized to look even, not to one height (Hulu shorter, Netflix’s N taller)', () => {
  const n = displaySize({ width: 40, height: 72, ink: 40 * 72 * 0.45 }); // narrow mark
  const hulu = displaySize({ width: 120, height: 75, ink: 120 * 75 * 0.6 }); // wide, bold wordmark
  const thin = displaySize({ width: 120, height: 75, ink: 120 * 75 * 0.2 }); // same shape, thin strokes
  expect(n.height).toBeGreaterThan(hulu.height);
  expect(thin.height).toBeGreaterThan(hulu.height);
  // Similar visual weight: box areas within ~2x of each other.
  const area = (s) => s.width * s.height;
  expect(Math.max(area(n), area(hulu)) / Math.min(area(n), area(hulu))).toBeLessThan(2.2);
  // Never wider than the row allows.
  expect(displaySize({ width: 400, height: 40, ink: 400 * 40 * 0.4 }).width).toBeLessThanOrEqual(76);
});

const W = 20;
const H = 20;

// RGBA pixels: a tile coloured by `bg(x, y)` with a `mark` colour inside the box.
function tile(bg, mark, box = { x: 6, y: 5, w: 8, h: 10 }, alpha = 255) {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = (y * W + x) * 4;
      const inMark = x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h;
      const [r, g, b, a] = inMark ? [...mark, 255] : [...bg(x, y), alpha];
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
    }
  }
  return px;
}
const alphaAt = (px, x, y) => px[(y * W + x) * 4 + 3];
const rgbAt = (px, x, y) => [...px.slice((y * W + x) * 4, (y * W + x) * 4 + 3)];

test('a Netflix-style tile loses its black square and keeps the red mark', () => {
  const px = tile(() => [0, 0, 0], [229, 9, 20]);
  const { bounds, recoloured } = removeTile(px, W, H);
  expect(bounds).toEqual({ x: 6, y: 5, width: 8, height: 10 });
  expect(recoloured).toBe(false);
  expect(alphaAt(px, 0, 0)).toBe(0);
  expect(alphaAt(px, 2, 15)).toBe(0);
  expect(rgbAt(px, 9, 9)).toEqual([229, 9, 20]);
  expect(alphaAt(px, 9, 9)).toBe(255);
});

test('gradient tiles come off too (the background is read from all four edges)', () => {
  const gradient = (x, y) => [20 + x * 4, 40 + y * 5, 120];
  const px = tile(gradient, [250, 250, 250]);
  expect(tileBackground(tile(gradient, [250, 250, 250]), W, H)(10, 10).map(Math.round)).toEqual(gradient(10, 10));
  const { bounds } = removeTile(px, W, H);
  expect(bounds).toEqual({ x: 6, y: 5, width: 8, height: 10 });
  for (const [x, y] of [[1, 1], [18, 2], [3, 17], [17, 18], [10, 2]]) expect(alphaAt(px, x, y)).toBe(0);
});

test('a logo already on a transparent background is left as it is', () => {
  const px = tile(() => [0, 0, 0], [255, 200, 0], undefined, 0);
  expect(tileBackground(px, W, H)).toBeNull();
  const { bounds } = removeTile(px, W, H);
  expect(bounds).toEqual({ x: 6, y: 5, width: 8, height: 10 });
  expect(rgbAt(px, 9, 9)).toEqual([255, 200, 0]);
});

test('a mark too dark for the popup (a black apple on white) is drawn light', () => {
  const px = tile(() => [255, 255, 255], [0, 0, 0]);
  const { bounds, recoloured } = removeTile(px, W, H);
  expect(bounds).not.toBeNull();
  expect(recoloured).toBe(true);
  expect(contrast(rgbAt(px, 9, 9), [18, 21, 29])).toBeGreaterThan(10);
});

test('only the dark parts of a mixed mark are lightened (YouTube TV: red button, grey text)', () => {
  const px = tile(() => [255, 255, 255], [230, 0, 0]);
  // Grey "lettering" beside the red button.
  for (let y = 7; y < 12; y += 1) for (let x = 15; x < 18; x += 1) { const i = (y * W + x) * 4; px[i] = 40; px[i + 1] = 40; px[i + 2] = 40; }
  removeTile(px, W, H);
  expect(rgbAt(px, 9, 9)).toEqual([230, 0, 0]);
  expect(contrast(rgbAt(px, 16, 9), [18, 21, 29])).toBeGreaterThan(10);
});

test('dark colours (Roku’s purple) stay; only black and grey are lightened', () => {
  const px = tile(() => [255, 255, 255], [102, 45, 145]);
  const { recoloured } = removeTile(px, W, H);
  expect(recoloured).toBe(false);
  expect(rgbAt(px, 9, 9)).toEqual([102, 45, 145]);
});

// Transparent canvas with solid rectangles drawn on it.
function canvas(w, h, rects) {
  const px = new Uint8ClampedArray(w * h * 4);
  rects.forEach(({ x, y, w: rw, h: rh }) => {
    for (let yy = y; yy < y + rh; yy += 1) for (let xx = x; xx < x + rw; xx += 1) { const i = (yy * w + xx) * 4; px[i] = 200; px[i + 3] = 255; }
  });
  return px;
}
const filledRows = (px, w, h) => Array.from({ length: h }, (_, y) => [...Array(w).keys()].some((x) => px[(y * w + x) * 4 + 3] > 0));

test('small caption text under or over a mark is removed (“Stream”, “Google Play”, “The … Channel”)', () => {
  const w = 40; const h = 40;
  // Big mark in rows 8–27; "The" above (rows 2–5), "Channel" below (rows 31–34).
  const letters = (y) => [0, 1, 2, 3, 4].map((k) => ({ x: 4 + k * 6, y, w: 4, h: 4 }));
  const px = canvas(w, h, [{ x: 6, y: 8, w: 28, h: 20 }, ...letters(2), ...letters(31)]);
  expect(removeCaptions(px, w, h)).toBe(2);
  const rows = filledRows(px, w, h);
  expect(rows.slice(8, 28).every(Boolean)).toBe(true);
  expect(rows.slice(0, 7).some(Boolean)).toBe(false);
  expect(rows.slice(29).some(Boolean)).toBe(false);
});

test('a single short shape (Prime Video’s smile) and two-line logos (HBO Max) stay', () => {
  const w = 40; const h = 40;
  const smile = canvas(w, h, [{ x: 6, y: 4, w: 28, h: 10 }, { x: 6, y: 17, w: 28, h: 10 }, { x: 8, y: 30, w: 24, h: 3 }]);
  expect(removeCaptions(smile, w, h)).toBe(0);
  const twoLines = canvas(w, h, [0, 1, 2].flatMap((k) => [{ x: 4 + k * 12, y: 4, w: 9, h: 12 }, { x: 4 + k * 12, y: 22, w: 9, h: 12 }]));
  expect(removeCaptions(twoLines, w, h)).toBe(0);
});

test('if the background can’t be told apart, it gives up (the original tile is shown)', () => {
  // Noise everywhere: no edge colour that matches the inside.
  const noisy = (x, y) => [(x * 97 + y * 31) % 256, (x * 13 + y * 71) % 256, (x * 53 + y * 7) % 256];
  const px = tile(noisy, [128, 128, 128], { x: 0, y: 0, w: 0, h: 0 });
  // Make the inside differ from what the edges predict, so most of it stays.
  for (let y = 2; y < H - 2; y += 1) for (let x = 2; x < W - 2; x += 1) { const i = (y * W + x) * 4; px[i] = 255 - px[i]; }
  expect(removeTile(px, W, H).bounds).toBeNull();
});
