// Where each previous take's plant sits (docs/fable-consult-2.md, 2.2 and 2.5).
// Angles: 0 = right, 90° = up, in halo space (ring radius 1, centre at origin).
//
// All plants grow from one hub behind the neck and end on one shared, flattened outline. The arc
// outside layout.downGap (the space behind the body) is tiled into one angular *territory* per
// plant; neighbouring territories overlap a little (plants.overlap) so plants interleave at the
// seams. Several plants therefore read as one wide canopy that cradles the avatar.

import type { Params } from './params';
import { clamp, deg } from './math';

export type PlantKind = 'crown' | 'wing' | 'wedge';

export interface Placement {
  ox: number;
  oy: number;
  /** Growth direction (radians). Plants grow along local +Y, which is rotated to this angle. */
  angle: number;
  scale: number;
  /** +1 outer tier, -1 inner tier (spins the other way). */
  tierDir: number;
  kind: PlantKind;
  /** Length multiplier for alternate plants in a crowded tier. */
  lengthMul?: number;
  /** World-angle territory this plant fills (radians, lo < hi; may exceed pi). */
  sectorLo: number;
  sectorHi: number;
  /** The territory a tree built now grows into (growth.fillSpace: wider while a neighbouring take
   *  has been away for a while). Only new trees use it; unset = sectorLo..sectorHi. */
  growLo?: number;
  growHi?: number;
}

/** The arc the plants share (radians): everything except downGap straight down. */
export function plantArc(p: Params): [number, number] {
  const gap = p.layout.spinSpeed === 0 ? clamp(p.layout.downGap, 0, 300) : 0;
  return [(-90 + gap / 2) * deg, (270 - gap / 2) * deg];
}

/**
 * presence (per take, 0..1, optional): 1 = here; toward 0 = away for a while (no tree, silent).
 * With growth.fillSpace, the takes that are here get wider territories for the trees they build
 * next (Placement.growLo / growHi), taking over the space of the ones that are away. The
 * placements themselves (angle, sectorLo / sectorHi) do not change, so nothing rebuilds or turns.
 */
export function layoutTakes(n: number, p: Params, presence?: ArrayLike<number>): Placement[] {
  const L = p.layout;
  const out: Placement[] = [];
  if (n <= 0) return out;
  const [arcLo, arcHi] = plantArc(p);
  const widen = (lo: number, hi: number) => {
    const m = 0.25 * clamp(p.plants.overlap) * (hi - lo);
    return { sectorLo: Math.max(arcLo, lo - m), sectorHi: Math.min(arcHi, hi + m) };
  };
  /** Territories [lo, hi] (no overlap yet), in order from arcHi down, of one tier, and their takes. */
  const groups: { lo: number; hi: number; k: number }[][] = [];

  if (n === 1) {
    // The hub is the origin (plants.trunk grows a trunk into it from below).
    out.push({ ox: 0, oy: L.midOriginY, angle: 90 * deg, scale: 1, tierDir: 1, kind: 'crown', ...widen(arcLo, arcHi) });
    return out;
  }
  if (n === 2) {
    const g: { lo: number; hi: number; k: number }[] = [];
    for (const [lo, hi] of [[90 * deg, arcHi], [arcLo, 90 * deg]]) {
      g.push({ lo, hi, k: out.length });
      out.push({ ox: 0, oy: L.midOriginY, angle: (lo + hi) / 2, scale: 1, tierDir: 1, kind: 'wing', ...widen(lo, hi) });
    }
    groups.push(g);
    return fillSpace(out, groups, p, presence, widen);
  }

  // 3+: equal territories across the arc, clockwise from the left. 7+: two tiers; the inner tier
  // uses the same outline (its scale shrinks it) with territories offset by half a step.
  const tiers = n >= L.tierFrom ? [Math.ceil(n / 2), Math.floor(n / 2)] : [n];
  const shrink = Math.max(0.5, 1 - L.shrinkPerTake * (n - 3));
  tiers.forEach((m, ti) => {
    const step = (arcHi - arcLo) / m;
    const g: { lo: number; hi: number; k: number }[] = [];
    groups.push(g);
    for (let k = 0; k < m; k++) {
      const phi = arcHi - (k + 0.5) * step - (ti === 0 ? 0 : step / 2);
      const lo = Math.max(arcLo, phi - step / 2), hi = Math.min(arcHi, phi + step / 2);
      g.push({ lo, hi, k: out.length });
      out.push({
        ox: 0, oy: L.midOriginY, angle: Math.max(arcLo, Math.min(arcHi, phi)),
        scale: shrink * (ti === 0 ? 1 : L.innerScale), tierDir: ti === 0 ? 1 : -1, kind: 'wedge',
        lengthMul: m >= 5 && k % 2 ? 0.92 : 1, ...widen(lo, hi),
      });
    }
  });
  return fillSpace(out, groups, p, presence, widen);
}

/** growth.fillSpace: within each tier, the takes that are here share the arc of the ones away. */
function fillSpace(out: Placement[], groups: { lo: number; hi: number; k: number }[][], p: Params,
                   presence: ArrayLike<number> | undefined,
                   widen: (lo: number, hi: number) => { sectorLo: number; sectorHi: number }): Placement[] {
  const fill = clamp(p.growth.fillSpace ?? 0);
  if (!presence || fill <= 0) return out;
  for (const g of groups) {
    if (g.length < 2) continue;
    // Each territory's weight: its width, shrunk toward nothing while its take is away.
    const w = g.map((t) => (t.hi - t.lo) * Math.max(0.02, 1 - fill * (1 - clamp(presence[t.k] ?? 1))));
    const total = g.reduce((a, t) => a + (t.hi - t.lo), 0), sum = w.reduce((a, b) => a + b, 0);
    if (sum <= 0 || Math.abs(sum - total) < 1e-6) continue; // everyone is here: as laid out
    let hi = g[0].hi;
    g.forEach((t, j) => {
      const lo = hi - (total * w[j]) / sum;
      const e = widen(lo, hi);
      out[t.k].growLo = e.sectorLo;
      out[t.k].growHi = e.sectorHi;
      hi = lo;
    });
  }
  return out;
}

/** Plant-local point → halo space. */
export function toWorld(lx: number, ly: number, pl: Placement, extraAngle = 0): [number, number] {
  const th = pl.angle + extraAngle - Math.PI / 2;
  const c = Math.cos(th) * pl.scale;
  const s = Math.sin(th) * pl.scale;
  return [pl.ox + c * lx - s * ly, pl.oy + s * lx + c * ly];
}

/** Halo-space point → plant-local. */
export function toLocal(wx: number, wy: number, pl: Placement): [number, number] {
  const th = pl.angle - Math.PI / 2, c = Math.cos(th), s = Math.sin(th);
  const dx = wx - pl.ox, dy = wy - pl.oy, sc = Math.max(1e-3, pl.scale);
  return [(c * dx + s * dy) / sc, (-s * dx + c * dy) / sc];
}

/** The shared canopy outline (plant units, before scale): half-width a, top b, bottom bDown. */
export function outlineOf(p: Params, effortMul = 1, lengthMul = 1) {
  const a = 2.15 * p.growth.reach * effortMul * lengthMul;
  const round = p.layout.spinSpeed !== 0; // flattening means nothing for rotating plants
  const b = round ? a * 0.8 : a * (1 - 0.6 * clamp(p.growth.flatten));
  return { a, b, bDown: round ? b : 0.85 * b };
}

/** Outline radius about the hub at world angle phi (a superellipse: slightly boxy, flat top). */
export function rOutAt(phi: number, o: { a: number; b: number; bDown: number }) {
  const E = 2.4;
  const c = Math.abs(Math.cos(phi)), s = Math.sin(phi), bb = s >= 0 ? o.b : o.bDown;
  return Math.pow(Math.pow(c / o.a, E) + Math.pow(Math.abs(s) / bb, E), -1 / E);
}
