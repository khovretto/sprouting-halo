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
}

/** The arc the plants share (radians): everything except downGap straight down. */
export function plantArc(p: Params): [number, number] {
  const gap = p.layout.spinSpeed === 0 ? clamp(p.layout.downGap, 0, 300) : 0;
  return [(-90 + gap / 2) * deg, (270 - gap / 2) * deg];
}

export function layoutTakes(n: number, p: Params): Placement[] {
  const L = p.layout;
  const out: Placement[] = [];
  if (n <= 0) return out;
  const [arcLo, arcHi] = plantArc(p);
  const widen = (lo: number, hi: number) => {
    const m = 0.25 * clamp(p.plants.overlap) * (hi - lo);
    return { sectorLo: Math.max(arcLo, lo - m), sectorHi: Math.min(arcHi, hi + m) };
  };

  if (n === 1) {
    out.push({ ox: 0, oy: L.lowOriginY, angle: 90 * deg, scale: 1, tierDir: 1, kind: 'crown', ...widen(arcLo, arcHi) });
    return out;
  }
  if (n === 2) {
    for (const [lo, hi] of [[90 * deg, arcHi], [arcLo, 90 * deg]]) {
      out.push({ ox: 0, oy: L.midOriginY, angle: (lo + hi) / 2, scale: 1, tierDir: 1, kind: 'wing', ...widen(lo, hi) });
    }
    return out;
  }

  // 3+: equal territories across the arc, clockwise from the left. 7+: two tiers; the inner tier
  // uses the same outline (its scale shrinks it) with territories offset by half a step.
  const tiers = n >= L.tierFrom ? [Math.ceil(n / 2), Math.floor(n / 2)] : [n];
  const shrink = Math.max(0.5, 1 - L.shrinkPerTake * (n - 3));
  tiers.forEach((m, ti) => {
    const step = (arcHi - arcLo) / m;
    for (let k = 0; k < m; k++) {
      const phi = arcHi - (k + 0.5) * step - (ti === 0 ? 0 : step / 2);
      const lo = Math.max(arcLo, phi - step / 2), hi = Math.min(arcHi, phi + step / 2);
      out.push({
        ox: 0, oy: L.midOriginY, angle: Math.max(arcLo, Math.min(arcHi, phi)),
        scale: shrink * (ti === 0 ? 1 : L.innerScale), tierDir: ti === 0 ? 1 : -1, kind: 'wedge',
        lengthMul: m >= 5 && k % 2 ? 0.92 : 1, ...widen(lo, hi),
      });
    }
  });
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
