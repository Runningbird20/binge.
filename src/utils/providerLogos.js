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

// Pieces of the mark: 4-connected runs of pixels that pass `inside(index)`.
// → { pieces: [{ members, opacity }], owner: piece index per pixel (-1 none) }.
function findPieces(px, width, height, inside) {
  const owner = new Int32Array(width * height).fill(-1);
  const pieces = [];
  for (let start = 0; start < width * height; start += 1) {
    if (owner[start] >= 0 || !inside(start)) continue;
    const id = pieces.length;
    const members = [start];
    owner[start] = id;
    let alpha = 0;
    for (let k = 0; k < members.length; k += 1) {
      const idx = members[k];
      alpha += px[idx * 4 + 3] / 255;
      const x = idx % width; const y = (idx - x) / width;
      if (x + 1 < width && owner[idx + 1] < 0 && inside(idx + 1)) { owner[idx + 1] = id; members.push(idx + 1); }
      if (x > 0 && owner[idx - 1] < 0 && inside(idx - 1)) { owner[idx - 1] = id; members.push(idx - 1); }
      if (y + 1 < height && owner[idx + width] < 0 && inside(idx + width)) { owner[idx + width] = id; members.push(idx + width); }
      if (y > 0 && owner[idx - width] < 0 && inside(idx - width)) { owner[idx - width] = id; members.push(idx - width); }
    }
    pieces.push({ members, opacity: alpha / members.length });
  }
  return { pieces, owner };
}

// Leftovers of a tile's glow or vignette (the smudge above Starz): separate,
// mostly see-through blobs, and specks with nothing else near them. The
// biggest piece is the mark and always stays; so do small parts that sit
// close to the rest (Peacock's dots, an i's dot, a ®). The faint haze no
// piece owns goes too.
export function removeResidue(px, width, height) {
  const { pieces, owner } = findPieces(px, width, height, (idx) => px[idx * 4 + 3] >= SOLID);
  const biggest = pieces.reduce((best, p) => (!best || p.members.length > best.members.length ? p : best), null);
  const near = 6;
  const isolated = (p, id) => p.members.every((idx) => {
    const x = idx % width; const y = (idx - x) / width;
    for (let ny = Math.max(0, y - near); ny <= Math.min(height - 1, y + near); ny += 1) {
      for (let nx = Math.max(0, x - near); nx <= Math.min(width - 1, x + near); nx += 1) {
        const other = owner[ny * width + nx];
        if (other >= 0 && other !== id) return false;
      }
    }
    return true;
  });
  let removed = 0;
  pieces.forEach((p, id) => {
    if (p === biggest) return;
    const speck = p.members.length < Math.max(6, biggest.members.length * 0.01) && isolated(p, id);
    if (p.opacity >= 0.5 && !speck) return;
    p.members.forEach((idx) => { px[idx * 4 + 3] = 0; });
    removed += 1;
  });
  // See-through haze that isn't part of any piece (it would also widen the
  // bounds); the soft edge right around the mark stays.
  for (let idx = 0; idx < width * height; idx += 1) {
    const i = idx * 4 + 3;
    if (px[i] === 0 || px[i] >= SOLID) continue;
    const x = idx % width; const y = (idx - x) / width;
    let touches = false;
    for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1) && !touches; ny += 1) {
      for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx += 1) {
        if (px[(ny * width + nx) * 4 + 3] >= SOLID) { touches = true; break; }
      }
    }
    if (!touches) px[i] = 0;
  }
  return removed;
}

// Shapes cut out of a solid plate show the tile through them: YouTube's
// triangle, the letters in Cinemax's bar and TBS's badge. On the popup they'd
// turn into holes, so they get their original pixels back. A plate is a big,
// filled piece (most of the mark, its outline mostly solid, more plate than
// cut-out); letter counters (the inside of an O or B) aren't, and stay
// see-through. Returns a mask of the pixels put back.
export function restoreCutouts(px, original, width, height) {
  const restored = new Uint8Array(width * height);
  const { pieces, owner } = findPieces(px, width, height, (idx) => px[idx * 4 + 3] >= SOLID);
  if (!pieces.length) return restored;
  let minX = width; let minY = height; let maxX = -1; let maxY = -1;
  pieces.forEach((p) => p.members.forEach((idx) => {
    const x = idx % width; const y = (idx - x) / width;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }));
  const markW = maxX - minX + 1; const markH = maxY - minY + 1;
  pieces.forEach((p, id) => {
    let x0 = width; let y0 = height; let x1 = -1; let y1 = -1;
    p.members.forEach((idx) => {
      const x = idx % width; const y = (idx - x) / width;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    });
    const w = x1 - x0 + 1; const h = y1 - y0 + 1;
    if (w < markW * 0.5 || h < markH * 0.5 || p.members.length < 200) return;
    // Everything the plate encloses: not reachable from outside its box
    // without crossing it.
    const bw = w + 2; const bh = h + 2;
    const outside = new Uint8Array(bw * bh);
    const stack = [0];
    outside[0] = 1;
    while (stack.length) {
      const k = stack.pop();
      const bx = k % bw; const by = (k - bx) / bw;
      for (const [nx, ny] of [[bx + 1, by], [bx - 1, by], [bx, by + 1], [bx, by - 1]]) {
        if (nx < 0 || nx >= bw || ny < 0 || ny >= bh) continue;
        const n = ny * bw + nx;
        if (outside[n]) continue;
        const x = x0 + nx - 1; const y = y0 + ny - 1;
        const inPlate = x >= 0 && y >= 0 && x < width && y < height && owner[y * width + x] === id;
        if (!inPlate) { outside[n] = 1; stack.push(n); }
      }
    }
    const enclosed = [];
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const idx = y * width + x;
        if (owner[idx] !== id && !outside[(y - y0 + 1) * bw + (x - x0 + 1)]) enclosed.push(idx);
      }
    }
    const solid = p.members.length;
    const filled = (solid + enclosed.length) / (w * h);
    if (filled < 0.8 || enclosed.length < (solid + enclosed.length) * 0.04 || solid < enclosed.length * 1.2) return;
    const put = (idx) => {
      restored[idx] = 1;
      for (let c = 0; c < 4; c += 1) px[idx * 4 + c] = original[idx * 4 + c];
    };
    enclosed.forEach(put);
    // The plate itself, as it was drawn (cut-outs that touch it, like TBS's
    // t, are part of it), except its outer edge, which stays un-mixed from
    // the tile.
    const onEdge = (x, y) => {
      for (let ny = y - 1; ny <= y + 1; ny += 1) {
        for (let nx = x - 1; nx <= x + 1; nx += 1) if (outside[(ny - y0 + 1) * bw + (nx - x0 + 1)]) return true;
      }
      return false;
    };
    p.members.forEach((idx) => {
      const x = idx % width; const y = (idx - x) / width;
      if (!onEdge(x, y)) put(idx);
    });
  });
  return restored;
}

// Channel tiles ("Lionsgate+ Amazon Channel", "Starz Roku Premium Channel")
// end in a footer band of another colour carrying the reseller's name. The
// row where both side edges change colour at once is its top; null if none.
export function footerTop(px, width, height) {
  const inset = Math.max(1, Math.round(Math.min(width, height) * 0.015));
  const at = (x, y) => { const i = (y * width + x) * 4; return px[i + 3] >= 200 ? [px[i], px[i + 1], px[i + 2]] : null; };
  const jump = (x, y) => {
    const above = at(x, y - 2); const below = at(x, y + 2);
    return above && below ? Math.hypot(above[0] - below[0], above[1] - below[1], above[2] - below[2]) : 0;
  };
  let best = null;
  for (let y = Math.round(height * 0.55); y < Math.round(height * 0.92); y += 1) {
    const strength = Math.min(jump(inset, y), jump(width - 1 - inset, y));
    if (strength >= 80 && (!best || strength > best.strength)) best = { y, strength };
  }
  return best ? best.y : null;
}

// In place on RGBA pixels: removes the tile (and caption text), returns the
// mark's bounds (or null if nothing usable is left) and whether it was
// recoloured light.
export function removeTile(px, width, height, { lo = 38, hi = 110, background = POPUP_BG } = {}) {
  const tileAt = tileBackground(px, width, height);
  const original = px.slice();
  const keep = new Float32Array(width * height);
  const tiles = tileAt ? new Float32Array(width * height * 3) : null;
  let keptAlpha = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      const i = idx * 4;
      if (!tileAt) { keep[idx] = 1; keptAlpha += px[i + 3] / 255; continue; }
      const tile = tileAt(x, y);
      tiles.set(tile, idx * 3);
      const d = Math.hypot(px[i] - tile[0], px[i + 1] - tile[1], px[i + 2] - tile[2]);
      keep[idx] = px[i + 3] < 128 ? 0 : Math.min(1, Math.max(0, (d - lo) / (hi - lo)));
      keptAlpha += (px[i + 3] / 255) * keep[idx];
    }
  }
  // Most of a tile left over means its background wasn't found: show the
  // original tile rather than a block of colour.
  if (tileAt && keptAlpha > width * height * 0.8) return { bounds: null, recoloured: false };

  if (tileAt) {
    // Pixels well inside the mark (they and all their neighbours fully kept).
    const kept = (x, y) => x < 0 || y < 0 || x >= width || y >= height || keep[y * width + x] === 1;
    const interior = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let all = true;
        for (let ny = y - 1; ny <= y + 1 && all; ny += 1) for (let nx = x - 1; nx <= x + 1; nx += 1) if (!kept(nx, ny)) { all = false; break; }
        interior[y * width + x] = all ? 1 : 0;
      }
    }
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const idx = y * width + x;
        const i = idx * 4;
        const k = keep[idx];
        if (k === 0) { px[i + 3] = 0; continue; }
        if (interior[idx]) continue;
        // The mark's rim is anti-aliased: a mix of the mark and the tile.
        // Where a pixel is that mix, it takes the mark's colour (from the
        // nearest pixel inside the mark) and keeps only its share as
        // opacity, so no tile colour fringes the mark (Fawesome's white
        // letters had a red rim). A real outline in another colour isn't a
        // mix and stays as drawn.
        const tile = tiles.subarray(idx * 3, idx * 3 + 3);
        let mark = null;
        for (let r = 1; r <= 3 && !mark; r += 1) {
          for (let ny = Math.max(0, y - r); ny <= Math.min(height - 1, y + r) && !mark; ny += 1) {
            for (let nx = Math.max(0, x - r); nx <= Math.min(width - 1, x + r); nx += 1) {
              if (interior[ny * width + nx]) { mark = original.subarray((ny * width + nx) * 4, (ny * width + nx) * 4 + 3); break; }
            }
          }
        }
        const span = mark ? Math.hypot(mark[0] - tile[0], mark[1] - tile[1], mark[2] - tile[2]) : 0;
        if (span >= hi) {
          let dot = 0;
          for (let c = 0; c < 3; c += 1) dot += (px[i + c] - tile[c]) * (mark[c] - tile[c]);
          const share = Math.min(1, Math.max(0, dot / (span * span)));
          const off = Math.hypot(...[0, 1, 2].map((c) => px[i + c] - (tile[c] + share * (mark[c] - tile[c]))));
          if (off <= 40) {
            for (let c = 0; c < 3; c += 1) px[i + c] = mark[c];
            px[i + 3] = Math.round(px[i + 3] * share);
            continue;
          }
        }
        if (k < 1) {
          for (let c = 0; c < 3; c += 1) px[i + c] = Math.min(255, Math.max(0, (px[i + c] - tile[c] * (1 - k)) / k));
          px[i + 3] = Math.round(px[i + 3] * k);
        }
      }
    }
    // The outermost pixels, outside where the tile colour was read, are the
    // tile's own border (Lionsgate+ kept a thin line down each side).
    const inset = Math.max(1, Math.round(Math.min(width, height) * 0.015));
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (x < inset || y < inset || x >= width - inset || y >= height - inset) px[(y * width + x) * 4 + 3] = 0;
      }
    }
    // A reseller's footer band goes, as long as the mark is above it.
    const footer = footerTop(original, width, height);
    if (footer !== null) {
      const cut = Math.max(0, footer - 3);
      let above = 0; let below = 0;
      for (let i = 3; i < px.length; i += 4) { if ((i >> 2) < cut * width) above += px[i]; else below += px[i]; }
      if (above > below) for (let i = cut * width * 4 + 3; i < px.length; i += 4) px[i] = 0;
    }
  }

  removeCaptions(px, width, height);
  removeResidue(px, width, height);
  const restored = tileAt ? restoreCutouts(px, original, width, height) : new Uint8Array(width * height);

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
  // dark-mode logos.
  let darkAlpha = 0;
  const coloured = [];
  for (let i = 0; i < px.length; i += 4) {
    // Cut-outs put back sit on their plate, not on the popup.
    if (px[i + 3] === 0 || restored[i >> 2]) continue;
    const rgb = [px[i], px[i + 1], px[i + 2]];
    const chroma = Math.max(...rgb) - Math.min(...rgb);
    if (chroma >= 60) coloured.push(i);
    else if (contrast(rgb, background) < 2.2) {
      darkAlpha += px[i + 3] / 255;
      px[i] = LIGHT[0]; px[i + 1] = LIGHT[1]; px[i + 2] = LIGHT[2];
    }
  }
  // A coloured mark that is dark as a whole (Roku's purple) is lightened
  // evenly, so it keeps its own shading (Netflix's darker stems stay).
  const meanLuminance = (t) => {
    let sum = 0; let weight = 0;
    coloured.forEach((i) => {
      const a = px[i + 3];
      sum += a * luminance([px[i], px[i + 1], px[i + 2]].map((c) => c + (255 - c) * t));
      weight += a;
    });
    return weight ? sum / weight : 1;
  };
  // The luminance that has this contrast ratio with the (darker) popup.
  const luminanceFor = (ratio) => ratio * (luminance(background) + 0.05) - 0.05;
  if (coloured.length && meanLuminance(0) < luminanceFor(2.6)) {
    let low = 0; let high = 1;
    for (let k = 0; k < 10; k += 1) {
      const t = (low + high) / 2;
      if (meanLuminance(t) >= luminanceFor(3)) high = t; else low = t;
    }
    coloured.forEach((i) => { for (let c = 0; c < 3; c += 1) px[i + c] = Math.round(px[i + c] + (255 - px[i + c]) * high); });
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
