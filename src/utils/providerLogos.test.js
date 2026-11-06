import { contrast, displaySize, footerTop, removeCaptions, removeResidue, removeTile, tileBackground } from './providerLogos';

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

test('a dark coloured mark (Roku’s purple) is lightened just enough to read, keeping its hue', () => {
  const px = tile(() => [255, 255, 255], [102, 45, 145]);
  const { recoloured } = removeTile(px, W, H);
  expect(recoloured).toBe(false);
  const [r, g, b] = rgbAt(px, 9, 9);
  expect(b).toBeGreaterThan(r);
  expect(r).toBeGreaterThan(g);
  expect(contrast([r, g, b], [18, 21, 29])).toBeGreaterThan(2.9);
  expect(contrast([r, g, b], [18, 21, 29])).toBeLessThan(3.5);
});

test('a mark that reads as a whole keeps its own shading (Netflix’s darker stems)', () => {
  const px = tile(() => [0, 0, 0], [229, 9, 20]);
  // The left stem in a darker red.
  for (let y = 5; y < 15; y += 1) for (let x = 6; x < 8; x += 1) { const i = (y * W + x) * 4; px[i] = 150; px[i + 1] = 5; px[i + 2] = 15; }
  removeTile(px, W, H);
  expect(rgbAt(px, 6, 9)).toEqual([150, 5, 15]);
  expect(rgbAt(px, 10, 9)).toEqual([229, 9, 20]);
});

test('anti-aliased edges take the mark’s colour, not the tile’s (no red rim on Fawesome’s white letters)', () => {
  const px = tile(() => [255, 0, 0], [255, 255, 255]);
  // A half-covered column just right of the mark.
  for (let y = 5; y < 15; y += 1) { const i = (y * W + 14) * 4; px[i] = 255; px[i + 1] = 128; px[i + 2] = 128; }
  removeTile(px, W, H);
  expect(rgbAt(px, 14, 9)).toEqual([255, 255, 255]);
  expect(Math.abs(alphaAt(px, 14, 9) - 128)).toBeLessThanOrEqual(2);
  expect(alphaAt(px, 16, 9)).toBe(0);
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

test('specks with nothing near them go; small parts close to the mark stay (Peacock’s dots, a ®)', () => {
  const w = 40; const h = 40;
  const px = canvas(w, h, [
    { x: 5, y: 15, w: 20, h: 10 }, // the mark
    { x: 27, y: 16, w: 2, h: 2 }, // a dot beside it
    { x: 30, y: 2, w: 2, h: 2 }, // a speck far above
    { x: 5, y: 30, w: 6, h: 6 }, // a see-through blob (glow)
  ]);
  for (let y = 30; y < 36; y += 1) for (let x = 5; x < 11; x += 1) px[(y * w + x) * 4 + 3] = 80;
  expect(removeResidue(px, w, h)).toBe(2);
  const at = (x, y) => px[(y * w + x) * 4 + 3];
  expect(at(10, 20)).toBe(255);
  expect(at(27, 16)).toBe(255);
  expect(at(30, 2)).toBe(0);
  expect(at(7, 32)).toBe(0);
});

// A 60×60 tile in `bg` with rectangles of colour drawn on it, in order.
function bigTile(bg, rects) {
  const w = 60; const h = 60;
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i += 1) { px.set(bg, i * 4); px[i * 4 + 3] = 255; }
  rects.forEach(({ x, y, w: rw, h: rh, rgb }) => {
    for (let yy = y; yy < y + rh; yy += 1) for (let xx = x; xx < x + rw; xx += 1) px.set(rgb, (yy * w + xx) * 4);
  });
  return px;
}
const at60 = (px, x, y) => [...px.slice((y * 60 + x) * 4, (y * 60 + x) * 4 + 4)];

test('shapes cut out of a solid plate are kept (YouTube’s triangle, the letters in TBS’s badge)', () => {
  const RED = [230, 0, 0]; const WHITE = [255, 255, 255];
  const px = bigTile(WHITE, [{ x: 10, y: 15, w: 40, h: 30, rgb: RED }, { x: 25, y: 25, w: 10, h: 10, rgb: WHITE }]);
  const { bounds } = removeTile(px, 60, 60);
  expect(bounds).toEqual({ x: 10, y: 15, width: 40, height: 30 });
  expect(at60(px, 30, 30)).toEqual([255, 255, 255, 255]); // the cut-out, white as drawn
  expect(at60(px, 12, 17)).toEqual([230, 0, 0, 255]);
  expect(at60(px, 5, 5)[3]).toBe(0); // the tile itself still goes
});

test('letter counters stay see-through (the inside of each O in a wordmark)', () => {
  const RED = [230, 0, 0]; const WHITE = [255, 255, 255];
  // "OO": two square rings, each under half the mark's width.
  const ring = (x) => [{ x, y: 20, w: 16, h: 16, rgb: RED }, { x: x + 4, y: 24, w: 8, h: 8, rgb: WHITE }];
  const px = bigTile(WHITE, [...ring(10), ...ring(30)]);
  removeTile(px, 60, 60);
  expect(at60(px, 17, 27)[3]).toBe(0);
  expect(at60(px, 37, 27)[3]).toBe(0);
  expect(at60(px, 11, 21)[3]).toBe(255);
});

test('a reseller’s footer band is dropped (“prime video | CHANNELS” under Lionsgate+)', () => {
  const BLACK = [0, 0, 0]; const WHITE = [255, 255, 255];
  const px = bigTile(BLACK, [
    { x: 0, y: 45, w: 60, h: 15, rgb: WHITE }, // footer band
    { x: 15, y: 10, w: 30, h: 21, rgb: WHITE }, // the mark
    ...[10, 20, 30].map((x) => ({ x, y: 50, w: 4, h: 4, rgb: BLACK })), // footer text
  ]);
  expect(footerTop(px, 60, 60)).toBeGreaterThanOrEqual(42);
  expect(footerTop(px, 60, 60)).toBeLessThanOrEqual(46);
  const { bounds } = removeTile(px, 60, 60);
  expect(bounds).toEqual({ x: 15, y: 10, width: 30, height: 21 });
  expect(at60(px, 11, 51)[3]).toBe(0);
  expect(footerTop(bigTile(BLACK, [{ x: 15, y: 10, w: 30, h: 21, rgb: WHITE }]), 60, 60)).toBeNull();
});

test('if the background can’t be told apart, it gives up (the original tile is shown)', () => {
  // Noise everywhere: no edge colour that matches the inside.
  const noisy = (x, y) => [(x * 97 + y * 31) % 256, (x * 13 + y * 71) % 256, (x * 53 + y * 7) % 256];
  const px = tile(noisy, [128, 128, 128], { x: 0, y: 0, w: 0, h: 0 });
  // Make the inside differ from what the edges predict, so most of it stays.
  for (let y = 2; y < H - 2; y += 1) for (let x = 2; x < W - 2; x += 1) { const i = (y * W + x) * 4; px[i] = 255 - px[i]; }
  expect(removeTile(px, W, H).bounds).toBeNull();
});
