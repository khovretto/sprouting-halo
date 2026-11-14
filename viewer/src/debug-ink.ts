// Bunching / blobbing metrics (docs/fable-consult-2.md, 5.1), measured on what is actually drawn:
// the plants' stroke and leaf instances, transformed to world space and rasterised on a 0.02 grid.
// Works for any generator, so the same numbers compare the old and new trees.
//
//   sprout.ink()    -> inkMetrics       (after sprout.advance(…))
//   sprout.pixels() -> pixelMetrics     (read back from the last rendered frame)

import { FLOATS_PER_INSTANCE, Instances, LayerUniforms } from './render/renderer';

export interface InkInput {
  strokes: Instances[];
  sprites: Instances[];
  layers: LayerUniforms;
  /** Layer indices that belong to take plants (halos are excluded). */
  isPlantLayer: (layer: number) => boolean;
  blocked: (wx: number, wy: number) => boolean;
  hubX: number;
  hubY: number;
  /** Canopy outline half-width and heights (world units), and the arc in radians. */
  a: number;
  b: number;
  bDown: number;
  arcLo: number;
  arcHi: number;
}

const CELL = 0.02;
const X0 = -2.8, X1 = 2.8, Y0 = -1.9, Y1 = 2.1;
const NX = Math.round((X1 - X0) / CELL), NY = Math.round((Y1 - Y0) / CELL);

export function rOutOf(phi: number, a: number, b: number, bDown: number) {
  const E = 2.4;
  const c = Math.abs(Math.cos(phi)), s = Math.sin(phi), bb = s >= 0 ? b : bDown;
  return Math.pow(Math.pow(c / a, E) + Math.pow(Math.abs(s) / bb, E), -1 / E);
}

export function inkMetrics(inp: InkInput) {
  const cover = new Uint8Array(NX * NY);
  const count = new Uint16Array(NX * NY);
  const blockedAt = new Uint8Array(NX * NY);
  for (let j = 0; j < NY; j++)
    for (let i = 0; i < NX; i++) blockedAt[j * NX + i] = inp.blocked(X0 + (i + 0.5) * CELL, Y0 + (j + 0.5) * CELL) ? 1 : 0;

  const org = inp.layers.org, mat = inp.layers.mat;
  const toW = (L: number, x: number, y: number): [number, number] => {
    const o = L * 4;
    return [org[o] + mat[o] * x + mat[o + 2] * y, org[o + 1] + mat[o + 1] * x + mat[o + 3] * y];
  };
  const scaleOf = (L: number) => {
    const o = L * 4;
    return Math.sqrt(Math.abs(mat[o] * mat[o + 3] - mat[o + 1] * mat[o + 2]));
  };
  const stamp = (minX: number, minY: number, maxX: number, maxY: number, inside: (x: number, y: number) => boolean) => {
    const i0 = Math.max(0, Math.floor((minX - X0) / CELL)), i1 = Math.min(NX - 1, Math.floor((maxX - X0) / CELL));
    const j0 = Math.max(0, Math.floor((minY - Y0) / CELL)), j1 = Math.min(NY - 1, Math.floor((maxY - Y0) / CELL));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const k = j * NX + i;
        if (blockedAt[k]) continue;
        if (!inside(X0 + (i + 0.5) * CELL, Y0 + (j + 0.5) * CELL)) continue;
        cover[k] = 1;
        if (count[k] < 65535) count[k]++;
      }
  };

  for (const inst of inp.strokes) {
    const d = inst.data;
    for (let n = 0; n < inst.count; n++) {
      const o = n * FLOATS_PER_INSTANCE;
      const L = d[o + 13];
      if (!inp.isPlantLayer(L) || d[o + 11] < 0.05) continue;
      const s = scaleOf(L);
      const [ax, ay] = toW(L, d[o], d[o + 1]);
      const [bx, by] = toW(L, d[o + 2], d[o + 3]);
      const ra = d[o + 4] * s, rb = d[o + 5] * s;
      const r = Math.max(ra, rb, CELL * 0.5);
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      stamp(Math.min(ax, bx) - r, Math.min(ay, by) - r, Math.max(ax, bx) + r, Math.max(ay, by) + r, (x, y) => {
        const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
        const rr = Math.max(CELL * 0.5, ra + (rb - ra) * t);
        return Math.hypot(ax + dx * t - x, ay + dy * t - y) <= rr;
      });
    }
  }
  for (const inst of inp.sprites) {
    const d = inst.data;
    for (let n = 0; n < inst.count; n++) {
      const o = n * FLOATS_PER_INSTANCE;
      const L = d[o + 13];
      if (!inp.isPlantLayer(L) || d[o + 11] < 0.05) continue;
      const s = scaleOf(L);
      const size = d[o + 3] * s;
      if (size <= 0) continue;
      const [px, py] = toW(L, d[o], d[o + 1]);
      // Leaf axis direction in world space.
      const ang = d[o + 2];
      const [qx, qy] = toW(L, d[o] + Math.cos(ang), d[o + 1] + Math.sin(ang));
      let ux = qx - px, uy = qy - py;
      const ul = Math.hypot(ux, uy) || 1;
      ux /= ul;
      uy /= ul;
      const cx = px + ux * size * 0.5, cy = py + uy * size * 0.5;
      const ra = Math.max(CELL * 0.5, size * 0.5), rb = Math.max(CELL * 0.5, size * 0.34);
      stamp(cx - ra, cy - ra, cx + ra, cy + ra, (x, y) => {
        const lx = (x - cx) * ux + (y - cy) * uy, ly = -(x - cx) * uy + (y - cy) * ux;
        return (lx / ra) ** 2 + (ly / rb) ** 2 <= 1;
      });
    }
  }

  // Box-filtered coverage (window 0.24 = 12 cells) via a summed-area table.
  const sat = new Float64Array((NX + 1) * (NY + 1));
  for (let j = 0; j < NY; j++) {
    let row = 0;
    for (let i = 0; i < NX; i++) {
      row += cover[j * NX + i];
      sat[(j + 1) * (NX + 1) + (i + 1)] = sat[j * (NX + 1) + (i + 1)] + row;
    }
  }
  const W2 = 6;
  const dens = (i: number, j: number) => {
    const i0 = Math.max(0, i - W2), i1 = Math.min(NX, i + W2), j0 = Math.max(0, j - W2), j1 = Math.min(NY, j + W2);
    const sum = sat[j1 * (NX + 1) + i1] - sat[j0 * (NX + 1) + i1] - sat[j1 * (NX + 1) + i0] + sat[j0 * (NX + 1) + i0];
    return sum / Math.max(1, (i1 - i0) * (j1 - j0));
  };

  // Territory: inside the arc, at least 0.1 from the silhouette, within 0.9 of the outline.
  const nearSil = (x: number, y: number, dist: number) => {
    if (inp.blocked(x, y)) return true;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      if (inp.blocked(x + Math.cos(a) * dist, y + Math.sin(a) * dist)) return true;
    }
    return false;
  };
  const inArc = (phi: number) => {
    let p = phi;
    while (p < inp.arcLo) p += Math.PI * 2;
    while (p > inp.arcLo + Math.PI * 2) p -= Math.PI * 2;
    return p <= inp.arcHi;
  };
  let tN = 0, tSum = 0, tSq = 0, blob = 0, empty = 0, blobMax = 0;
  for (let j = 0; j < NY; j += 2)
    for (let i = 0; i < NX; i += 2) {
      const x = X0 + (i + 0.5) * CELL, y = Y0 + (j + 0.5) * CELL;
      const r = Math.hypot(x - inp.hubX, y - inp.hubY), phi = Math.atan2(y - inp.hubY, x - inp.hubX);
      if (!inArc(phi) || r > 0.9 * rOutOf(phi, inp.a, inp.b, inp.bDown) || nearSil(x, y, 0.1)) continue;
      const dd = dens(i, j);
      tN++;
      tSum += dd;
      tSq += dd * dd;
      if (dd > 0.5) blob++;
      if (dd < 0.04) empty++;
      blobMax = Math.max(blobMax, dd);
    }
  const mean = tSum / Math.max(1, tN);
  const sd = Math.sqrt(Math.max(0, tSq / Math.max(1, tN) - mean * mean));

  // Extent, overdraw, low reach, arc cover.
  let covered = 0, drawn = 0;
  const xs: number[] = [], ys: number[] = [];
  for (let j = 0; j < NY; j++)
    for (let i = 0; i < NX; i++) {
      const k = j * NX + i;
      if (!cover[k]) continue;
      covered++;
      drawn += count[k];
      xs.push(X0 + (i + 0.5) * CELL);
      ys.push(Y0 + (j + 0.5) * CELL);
    }
  const pct = (arr: number[], q: number) => {
    if (!arr.length) return 0;
    const s = [...arr].sort((p, q2) => p - q2);
    return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))];
  };
  const width = pct(xs, 0.99) - pct(xs, 0.01), height = pct(ys, 0.99) - pct(ys, 0.01);
  const absX = xs.map(Math.abs);
  let bins = 0, binsInk = 0;
  for (let deg = inp.arcLo; deg < inp.arcHi; deg += (5 * Math.PI) / 180) {
    bins++;
    const ro = rOutOf(deg + (2.5 * Math.PI) / 180, inp.a, inp.b, inp.bDown);
    let hit = false;
    for (let r = 0.5 * ro; r <= 0.85 * ro && !hit; r += 0.02) {
      const x = inp.hubX + Math.cos(deg) * r, y = inp.hubY + Math.sin(deg) * r;
      const i = Math.floor((x - X0) / CELL), j = Math.floor((y - Y0) / CELL);
      if (i >= 0 && i < NX && j >= 0 && j < NY && cover[j * NX + i]) hit = true;
    }
    if (hit) binsInk++;
  }

  const r3 = (v: number) => +v.toFixed(3);
  return {
    blobMax: r3(blobMax),
    blobShare: r3(blob / Math.max(1, tN)),
    emptyShare: r3(empty / Math.max(1, tN)),
    evenness: r3(mean > 0 ? sd / mean : 0),
    meanCover: r3(mean),
    overdraw: r3(drawn / Math.max(1, covered)),
    aspect: r3(height > 0 ? width / height : 0),
    halfWidth: r3(pct(absX, 0.95)),
    arcCover: r3(binsInk / Math.max(1, bins)),
    lowReach: r3(ys.length ? Math.min(...ys) : 0),
  };
}

/** Read the last rendered frame: share of clipped pixels and local contrast over the plants. */
export function pixelMetrics(gl: WebGL2RenderingContext, W: number, H: number, toWorld: (px: number, py: number) => [number, number],
                             blocked: (x: number, y: number) => boolean) {
  const buf = new Uint8Array(W * H * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  const luma = new Float32Array(W * H);
  const mask = new Uint8Array(W * H);
  let n = 0, sat = 0;
  for (let row = 0; row < H; row++)
    for (let x = 0; x < W; x++) {
      const k = (row * W + x) * 4;
      const a = buf[k + 3] / 255;
      const idx = (H - 1 - row) * W + x;
      const r = buf[k] / 255, g = buf[k + 1] / 255, b = buf[k + 2] / 255;
      luma[idx] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (a <= 0.5) continue;
      const [wx, wy] = toWorld(x, H - 1 - row);
      if (blocked(wx, wy)) continue;
      mask[idx] = 1;
      n++;
      if (Math.max(r, g, b) >= 0.98) sat++;
    }
  // 9x9 box blur of luma via a summed-area table.
  const satT = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += luma[y * W + x];
      satT[(y + 1) * (W + 1) + (x + 1)] = satT[y * (W + 1) + (x + 1)] + row;
    }
  }
  let diff = 0, lsum = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      if (!mask[idx]) continue;
      const x0 = Math.max(0, x - 4), x1 = Math.min(W, x + 5), y0 = Math.max(0, y - 4), y1 = Math.min(H, y + 5);
      const sum = satT[y1 * (W + 1) + x1] - satT[y0 * (W + 1) + x1] - satT[y1 * (W + 1) + x0] + satT[y0 * (W + 1) + x0];
      const blur = sum / ((x1 - x0) * (y1 - y0));
      diff += Math.abs(luma[idx] - blur);
      lsum += luma[idx];
    }
  return {
    saturatedShare: +(sat / Math.max(1, n)).toFixed(3),
    localContrast: +(lsum > 0 ? diff / lsum : 0).toFixed(3),
    pixels: n,
  };
}
