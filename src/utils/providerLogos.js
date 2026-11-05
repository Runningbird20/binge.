// Streaming-service logos without their tile. TMDB ships each provider's logo
// as a square app tile (Netflix's is a red N on black); the title popup shows
// just the mark on its own background. The tile colour is read from the edge,
// keyed out with soft edges (anti-aliasing un-mixed so no dark fringe stays),
// the mark is trimmed to its bounds, and a mark too dark for the popup (Apple's
// black apple) is drawn white instead. One canvas pass per logo, cached.
// image.tmdb.org sends Access-Control-Allow-Origin: *, so the canvas isn't tainted.

const POPUP_BG = [18, 21, 29]; // .td-modal background (#12151d)
const LIGHT = [242, 244, 248];

function luminance([r, g, b]) {
  const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// One edge of the tile as colours, a couple of pixels in (rounded corners are
// transparent): gaps filled from their neighbours, then median-smoothed so a
// mark touching the edge doesn't count as background. null if all transparent.
function edgeProfile(px, width, count, at) {
  const raw = Array.from({ length: count }, (_, k) => {
    const i = at(k) * 4;
    return px[i + 3] >= 200 ? [px[i], px[i + 1], px[i + 2]] : null;
  });
  if (!raw.some(Boolean)) return { colours: null, opaque: 0 };
  const opaque = raw.filter(Boolean).length;
  for (let k = 1; k < count; k += 1) if (!raw[k]) raw[k] = raw[k - 1];
  for (let k = count - 2; k >= 0; k -= 1) if (!raw[k]) raw[k] = raw[k + 1];
  const half = 4;
  const colours = raw.map((_, k) => [0, 1, 2].map((c) => {
    const window = raw.slice(Math.max(0, k - half), k + half + 1).map((col) => col[c]).sort((a, b) => a - b);
    return window[window.length >> 1];
  }));
  return { colours, opaque };
}

// The tile's colour at every pixel, blended in from its four edges (a Coons
// patch), so gradient tiles (Disney+, Hulu, Tubi) come off as cleanly as flat
// ones. null when the logo has no tile (its edge is transparent).
export function tileBackground(px, width, height) {
  const inset = Math.max(1, Math.round(Math.min(width, height) * 0.015));
  const top = edgeProfile(px, width, width, (x) => inset * width + x);
  const bottom = edgeProfile(px, width, width, (x) => (height - 1 - inset) * width + x);
  const left = edgeProfile(px, width, height, (y) => y * width + inset);
  const right = edgeProfile(px, width, height, (y) => y * width + (width - 1 - inset));
  const edge = 2 * width + 2 * height;
  if (!top.colours || !bottom.colours || !left.colours || !right.colours) return null;
  if ((top.opaque + bottom.opaque + left.opaque + right.opaque) < edge * 0.35) return null;
  const T = top.colours; const B = bottom.colours; const L = left.colours; const R = right.colours;
  const tl = T[0]; const tr = T[width - 1]; const bl = B[0]; const br = B[width - 1];
  return (x, y) => {
    const u = x / (width - 1); const v = y / (height - 1);
    return [0, 1, 2].map((c) => (1 - v) * T[x][c] + v * B[x][c] + (1 - u) * L[y][c] + u * R[y][c]
      - ((1 - u) * (1 - v) * tl[c] + u * (1 - v) * tr[c] + (1 - u) * v * bl[c] + u * v * br[c]));
  };
}

const SOLID = 64; // alpha that counts as part of the mark

// Pieces (4-connected runs of solid pixels, a few pixels or more) in rows y0..y1.
function countPieces(px, width, y0, y1) {
  const seen = new Uint8Array(width * (y1 - y0 + 1));
  const solid = (x, y) => px[(y * width + x) * 4 + 3] >= SOLID;
  let pieces = 0;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const k = (y - y0) * width + x;
      if (seen[k] || !solid(x, y)) continue;
      let area = 0;
      const stack = [[x, y]];
      seen[k] = 1;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        area += 1;
        for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
          if (nx < 0 || nx >= width || ny < y0 || ny > y1) continue;
          const nk = (ny - y0) * width + nx;
          if (!seen[nk] && solid(nx, ny)) { seen[nk] = 1; stack.push([nx, ny]); }
        }
      }
      if (area >= 4) pieces += 1;
    }
  }
  return pieces;
}

// Removes small caption text around a mark (Google Play's "Google Play" under
// the triangle, Fandango's "Stream" under the F, "The"/"Channel" around Roku).
// The mark is split into horizontal bands at empty rows; a band much shorter
// than the tallest one and made of several separate pieces (letters) is a
// caption. A single short piece (Prime Video's smile) and two-line logos of
// similar size (HBO Max, BritBox) stay. Returns how many bands were removed.
export function removeCaptions(px, width, height) {
  const rowFilled = Array.from({ length: height }, (_, y) => {
    for (let x = 0; x < width; x += 1) if (px[(y * width + x) * 4 + 3] >= SOLID) return true;
    return false;
  });
  const bands = [];
  for (let y = 0; y < height; y += 1) {
    if (!rowFilled[y]) continue;
    const start = y;
    while (y + 1 < height && rowFilled[y + 1]) y += 1;
    bands.push({ y0: start, y1: y, height: y - start + 1 });
  }
  if (bands.length < 2) return 0;
  const tallest = Math.max(...bands.map((b) => b.height));
  let removed = 0;
  bands.forEach((band) => {
    // Up to 65% of the mark's height: channel footers ("prime video |
    // CHANNELS",  tv) are bigger than plain captions; two-line logos have
    // lines of about the same height.
    if (band.height >= tallest * 0.65 || countPieces(px, width, band.y0, band.y1) < 3) return;
    // Clear the band and the faint anti-aliasing just around it.
    for (let y = Math.max(0, band.y0 - 1); y <= Math.min(height - 1, band.y1 + 1); y += 1) {
      for (let x = 0; x < width; x += 1) px[(y * width + x) * 4 + 3] = 0;
    }
    removed += 1;
  });
  return removed;
}

// Leftovers of a tile's glow or vignette (the smudge above Starz): separate,
// mostly see-through blobs. The biggest piece is the mark and always stays;
// any other piece whose average opacity is under half goes, and so does the
// faint haze no piece owns.
export function removeResidue(px, width, height) {
  const seen = new Uint8Array(width * height);
  const pieces = [];
  for (let start = 0; start < width * height; start += 1) {
    if (seen[start] || px[start * 4 + 3] < SOLID) continue;
    const members = [start];
    seen[start] = 1;
    let alpha = 0;
    for (let k = 0; k < members.length; k += 1) {
      const idx = members[k];
      alpha += px[idx * 4 + 3] / 255;
      const x = idx % width; const y = (idx - x) / width;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const n = ny * width + nx;
        if (!seen[n] && px[n * 4 + 3] >= SOLID) { seen[n] = 1; members.push(n); }
      }
    }
    pieces.push({ members, opacity: alpha / members.length });
  }
  const biggest = pieces.reduce((best, p) => (!best || p.members.length > best.members.length ? p : best), null);
  let removed = 0;
  pieces.forEach((p) => {
    if (p === biggest || p.opacity >= 0.5) return;
    p.members.forEach((idx) => { px[idx * 4 + 3] = 0; });
    removed += 1;
  });
  // Haze too faint to be part of any piece (it would also widen the bounds).
  for (let i = 3; i < px.length; i += 4) if (px[i] < 40) px[i] = 0;
  return removed;
}

// A colour lightened toward white, hue kept, until it reaches minContrast
// against the background (Roku's dark purple on the navy popup).
function lightenFor(rgb, background, minContrast) {
  if (contrast(rgb, background) >= minContrast) return rgb;
  let lo = 0; let hi = 1;
  for (let k = 0; k < 10; k += 1) {
    const t = (lo + hi) / 2;
    if (contrast(rgb.map((c) => c + (255 - c) * t), background) >= minContrast) hi = t; else lo = t;
  }
  return rgb.map((c) => Math.round(c + (255 - c) * hi));
}

// In place on RGBA pixels: removes the tile (and caption text), returns the
// mark's bounds (or null if nothing usable is left) and whether it was
// recoloured light.
export function removeTile(px, width, height, { lo = 38, hi = 110, background = POPUP_BG } = {}) {
  const tileAt = tileBackground(px, width, height);
  let keptAlpha = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      let a = px[i + 3] / 255;
      if (tileAt && a > 0) {
        const tile = tileAt(x, y);
        const d = Math.hypot(px[i] - tile[0], px[i + 1] - tile[1], px[i + 2] - tile[2]);
        const keep = Math.min(1, Math.max(0, (d - lo) / (hi - lo)));
        if (keep > 0 && keep < 1) {
          // Un-mix the tile colour from anti-aliased edge pixels.
          for (let c = 0; c < 3; c += 1) px[i + c] = Math.min(255, Math.max(0, (px[i + c] - tile[c] * (1 - keep)) / keep));
        }
        a *= keep;
        px[i + 3] = Math.round(a * 255);
      }
      keptAlpha += a;
    }
  }
  // Most of a tile left over means its background wasn't found: show the
  // original tile rather than a block of colour.
  if (tileAt && keptAlpha > width * height * 0.8) return { bounds: null, recoloured: false };

  removeCaptions(px, width, height);
  removeResidue(px, width, height);

  let minX = width; let minY = height; let maxX = -1; let maxY = -1;
  let alphaSum = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const a = px[(y * width + x) * 4 + 3] / 255;
      if (a > 0.1) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        alphaSum += a;
      }
    }
  }
  if (maxX < 0) return { bounds: null, recoloured: false };
  // Black and grey parts too dark to see on the popup (Apple's black apple,
  // YouTube TV's grey lettering) are drawn light, like the brands' own
  // dark-mode logos. Dark colours keep their hue and are only lightened
  // enough to read (Roku stays purple); bright ones are left alone.
  let darkAlpha = 0;
  const lightened = new Map();
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    const rgb = [px[i], px[i + 1], px[i + 2]];
    const chroma = Math.max(...rgb) - Math.min(...rgb);
    if (chroma < 60) {
      if (contrast(rgb, background) < 2.2) {
        darkAlpha += px[i + 3] / 255;
        px[i] = LIGHT[0]; px[i + 1] = LIGHT[1]; px[i + 2] = LIGHT[2];
      }
    } else if (contrast(rgb, background) < 3) {
      const key = (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
      if (!lightened.has(key)) lightened.set(key, lightenFor(rgb, background, 3));
      [px[i], px[i + 1], px[i + 2]] = lightened.get(key);
    }
  }
  return { bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }, ink: alphaSum, recoloured: darkAlpha > alphaSum * 0.1 };
}

const cache = new Map(); // logo URL -> Promise<data URL | null>
const SIZE = 154; // drawn at 154 px, shown at ~24 px: crisp on 3x screens

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

// The pixels of a logo, read through a canvas. A browser can hold an opaque
// copy of the image (cached for a plain <img>) that a canvas may not read;
// the second try asks for it under its own URL, which no such copy shares.
async function readPixels(url) {
  for (const src of [url, `${url}${url.includes('?') ? '&' : '?'}binge=cors`]) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const img = await loadImage(src);
      const canvas = document.createElement('canvas');
      canvas.width = SIZE; canvas.height = SIZE;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, SIZE, SIZE);
      return { canvas, ctx, data: ctx.getImageData(0, 0, SIZE, SIZE) };
    } catch {
      // load failed or the canvas is tainted: try the next URL
    }
  }
  return null;
}

// Optical sizing, so a row of logos looks even instead of all being the same
// height: wide wordmarks (Hulu, Peacock) get shorter, narrow marks (Netflix's
// N) taller, and bold, dense marks a little smaller than thin ones. width and
// height are the mark's own pixels; ink is its total coverage.
export function displaySize({ width, height, ink }, { base = 22, min = 12, max = 28, maxWidth = 76 } = {}) {
  const aspect = width / height;
  const density = Math.min(1, Math.max(0.05, ink / (width * height)));
  let h = Math.min(max, Math.max(min, base * aspect ** -0.5 * (0.45 / density) ** 0.25));
  let w = h * aspect;
  if (w > maxWidth) { w = maxWidth; h = w / aspect; }
  return { width: Math.round(w), height: Math.round(h) };
}

// The mark alone: { src (PNG data URL), width, height, ink } for
// displaySize, or null (then the original tile is shown).
export function logoWithoutTile(url) {
  if (!url) return Promise.resolve(null);
  if (!cache.has(url)) {
    cache.set(url, (async () => {
      try {
        const read = await readPixels(url);
        if (!read) return null;
        const { canvas, ctx, data } = read;
        const { bounds, ink } = removeTile(data.data, SIZE, SIZE);
        if (!bounds) return null;
        ctx.putImageData(data, 0, 0);
        const out = document.createElement('canvas');
        out.width = bounds.width; out.height = bounds.height;
        out.getContext('2d').drawImage(canvas, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
        return { src: out.toDataURL('image/png'), width: bounds.width, height: bounds.height, ink };
      } catch {
        return null; // canvas unavailable: the tile is shown instead
      }
    })());
  }
  return cache.get(url);
}
