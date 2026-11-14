// Where each previous take's plant sits (docs/procedural-growth-research.md §1.5).
// Angles: 0 = right, 90° = up, in halo space (ring radius 1, centre at origin).

import type { Params } from './params';
import { deg, lerp } from './math';

export type EnvelopeKind = 'crown' | 'wing' | 'wedge';

export interface Placement {
  ox: number;
  oy: number;
  /** Growth direction (radians). Plants grow along local +Y, which is rotated to this angle. */
  angle: number;
  scale: number;
  /** +1 outer tier, -1 inner tier (spins the other way). */
  tierDir: number;
  kind: EnvelopeKind;
  // Envelope in the plant's local frame (degrees for angles).
  rMin: number;
  length: number;
  halfAngle: number;
  bend: number;
  taper: number;
  /** Length multiplier for alternate plants in a crowded tier, so the outline is a star, not a disc. */
  lengthMul?: number;
}

export function layoutTakes(n: number, p: Params): Placement[] {
  const L = p.layout;
  const E = p.envelope;
  const reach = Math.max(0.1, p.growth.reach); // high-level branch length
  const spread = Math.max(0.05, p.growth.spread); // fan width
  const sweep = Math.max(0, p.growth.sweep); // upward / around-the-body sweep
  const out: Placement[] = [];
  if (n <= 0) return out;

  if (n === 1) {
    out.push({
      ox: 0, oy: L.lowOriginY, angle: 90 * deg, scale: 1, tierDir: 1, kind: 'crown',
      rMin: E.crownMin, length: E.crownLength * reach, halfAngle: E.crownHalfAngle * spread, bend: 0, taper: E.crownTaper,
    });
    return out;
  }

  // Bend sweeps each plant toward "up": +1 for a plant pointing left, -1 pointing right.
  const upward = (phi: number) => -Math.cos(phi * deg);

  if (n === 2) {
    for (const phi of [180 - L.wingTilt, L.wingTilt]) {
      out.push({
        ox: 0, oy: L.midOriginY, angle: phi * deg, scale: 1, tierDir: 1, kind: 'wing',
        rMin: E.wingMin, length: E.wingLength * reach, halfAngle: E.wingHalfAngle * spread,
        bend: E.wingBend * sweep * upward(phi), taper: E.wingTaper,
      });
    }
    return out;
  }

  // 3+: equiangular, clockwise. Straight down (270°, behind the body) always sits in the middle of
  // a gap: odd counts then put one plant straight up, even counts form an X-like spread.
  // The inner tier (many takes) is turned a further quarter step so it doesn't hide behind the
  // outer one and still keeps clear of straight down.
  // With downGap (and no spin) the plants share the arc above, leaving the space behind the body
  // free: e.g. six takes sit at 90 ± 22, 65 and 108 degrees.
  const tiers = n >= L.tierFrom ? [Math.ceil(n / 2), Math.floor(n / 2)] : [n];
  const shrink = Math.max(0.5, 1 - E.shrinkPerTake * (n - 3));
  const gap = L.spinSpeed === 0 ? Math.min(300, Math.max(0, L.downGap)) : 0;
  tiers.forEach((m, ti) => {
    const step = gap > 0 ? (360 - gap) / m : 360 / m;
    const phi0 = gap > 0
      ? 90 + ((m - 1) / 2) * step + (ti === 0 ? 0 : step / 2)
      : 270 + step / 2 + (ti === 0 ? 0 : step / 4);
    for (let k = 0; k < m; k++) {
      const phi = phi0 - k * step;
      out.push({
        lengthMul: m >= 5 && k % 2 ? 0.82 : 1,
        ox: 0, oy: L.midOriginY, angle: phi * deg,
        scale: shrink * (ti === 0 ? 1 : L.innerScale), tierDir: ti === 0 ? 1 : -1, kind: 'wedge',
        rMin: E.wedgeMin, length: E.wedgeLength * reach, halfAngle: Math.min(55, (E.wedgeFill * step) / 2) * spread,
        bend: E.wedgeBend * sweep * upward(phi), taper: E.wedgeTaper,
      });
    }
  });
  return out;
}

/** Map normalised envelope coords (u 0..1 along, v -1..1 across) to the plant's local frame. */
export function envelopePoint(u: number, v: number, e: Placement): [number, number] {
  const r = e.rMin + u * (e.length - e.rMin);
  const profile = lerp(1, Math.sin(Math.PI * (0.08 + 0.92 * u)), e.taper);
  const a = (e.bend * u + v * e.halfAngle * profile) * deg;
  return [r * Math.sin(a), r * Math.cos(a)];
}

/** Plant-local point → halo space. */
export function toWorld(lx: number, ly: number, pl: Placement, extraAngle = 0): [number, number] {
  const th = pl.angle + extraAngle - Math.PI / 2;
  const c = Math.cos(th) * pl.scale;
  const s = Math.sin(th) * pl.scale;
  return [pl.ox + c * lx - s * ly, pl.oy + s * lx + c * ly];
}
