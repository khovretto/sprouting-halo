// Automated shape checks for take trees (docs/fable-consult.md A7, revised in fable-consult-2.md
// for the hub layout). Used from the console: sprout.metrics() after sprout.advance(…).
// Directions are measured from the shared hub behind the neck; outline checks use limbs
// (order <= 1) only, since shoots end inside the canopy on purpose.

import type { Params } from './params';
import type { Placement } from './layout';
import { outlineOf, rOutAt, toLocal, toWorld } from './layout';
import type { Plant } from './growth/plant';

export interface PlantMetrics {
  /** Limb tips' distance to the outline (std / mean of r / rOut). 0.06 to 0.20: ragged, one canopy. */
  outlineCoV: number;
  /** Spread of the angular gaps between neighbouring limb tips (std / mean). <= 0.35 = no clumps. */
  tipGapCoV: number;
  /** Share of visible limb length (order <= 1) heading more than 60° off radial from the hub. <= 0.12. */
  tangentialShare: number;
  /** Share of stroke length near the silhouette (within 0.2) more than 35° off radial. Should be ~0. */
  hugNearSilhouette: number;
  /** Share of stroke length visible (not behind the avatar). Above 0.75. */
  visibleShare: number;
  limbTips: number;
  nodes: number;
}

export function plantMetrics(plant: Plant, pl: Placement, p: Params, blocked: (x: number, y: number) => boolean): PlantMetrics {
  const sk = plant.sk;
  const n = sk.n;
  const [cx, cy] = toLocal(p.avatar.headX, p.layout.midOriginY, pl);
  const o = outlineOf(p, 1, pl.lengthMul ?? 1);
  const worldPhi = (x: number, y: number) => pl.angle - Math.atan2(x - cx, y - cy);

  const ratios: number[] = [];
  const phis: number[] = [];
  for (let i = 1; i < n; i++) {
    if (sk.children[i] !== 0 || plant.order[i] > 1) continue;
    const [wx, wy] = toWorld(sk.x[i], sk.y[i], pl);
    if (blocked(wx, wy)) continue;
    const phi = worldPhi(sk.x[i], sk.y[i]);
    ratios.push(Math.hypot(sk.x[i] - cx, sk.y[i] - cy) / rOutAt(phi, o));
    phis.push(phi);
  }
  const cov = (v: number[]) => {
    const m = v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, v.length));
    return m > 0 ? sd / m : 0;
  };
  const mid = (pl.sectorLo + pl.sectorHi) / 2;
  const un = phis.map((f) => mid + Math.atan2(Math.sin(f - mid), Math.cos(f - mid))).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let k = 1; k < un.length; k++) gaps.push(un[k] - un[k - 1]);

  let total = 0, tangential = 0, nearTotal = 0, nearBad = 0, visible = 0;
  for (let i = 1; i < n; i++) {
    const pa = sk.parent[i];
    if (pa < 0) continue;
    const len = Math.hypot(sk.x[i] - sk.x[pa], sk.y[i] - sk.y[pa]);
    const mx = (sk.x[i] + sk.x[pa]) / 2, my = (sk.y[i] + sk.y[pa]) / 2;
    const [wx, wy] = toWorld(mx, my, pl);
    total += len;
    const hidden = blocked(wx, wy);
    if (!hidden) visible += len;
    if (hidden || Math.hypot(mx - cx, my - cy) < 0.12 || len < 1e-6) continue;
    const dh = Math.atan2(sk.x[i] - sk.x[pa], sk.y[i] - sk.y[pa]) - Math.atan2(mx - cx, my - cy);
    const off = Math.abs(Math.atan2(Math.sin(dh), Math.cos(dh)));
    if (plant.order[i] <= 1 && off > (60 * Math.PI) / 180) tangential += len;
    let near = false;
    for (let k = 0; k < 8 && !near; k++) {
      const a = (k / 8) * Math.PI * 2;
      if (blocked(wx + Math.cos(a) * 0.2, wy + Math.sin(a) * 0.2)) near = true;
    }
    if (near && plant.order[i] <= 1) {
      nearTotal += len;
      if (off > (35 * Math.PI) / 180) nearBad += len;
    }
  }

  return {
    outlineCoV: cov(ratios),
    tipGapCoV: cov(gaps),
    tangentialShare: tangential / Math.max(1e-6, visible),
    hugNearSilhouette: nearBad / Math.max(1e-6, nearTotal),
    visibleShare: visible / Math.max(1e-6, total),
    limbTips: ratios.length,
    nodes: n,
  };
}
