// Automated shape checks for take trees (docs/fable-consult.md, A7). Used from the console:
// sprout.metrics() after sprout.advance(…). Each check has a pass threshold from the consult.

import type { Placement } from './layout';
import { toWorld } from './layout';
import type { Plant } from './growth/plant';

export interface PlantMetrics {
  /** Spread of tip distances of spine and feathers (std / mean). Above 0.15 = not an arc. */
  outlineCoV: number;
  /** Share of stroke length heading more than 60° off radial. Below 0.05 = nothing hugs. */
  tangentialShare: number;
  /** Share of stroke length near the silhouette (within 0.2) more than 35° off radial. Should be ~0. */
  hugNearSilhouette: number;
  /** Share of stroke length visible (not behind the avatar). Above 0.75. */
  visibleShare: number;
  /** Share of angles on a circle of radius 1.25 (world) within 0.04 of a stroke. Below 0.6. */
  coveredAt125: number;
  nodes: number;
}

export function plantMetrics(plant: Plant, pl: Placement, blocked: (x: number, y: number) => boolean): PlantMetrics {
  const sk = plant.sk;
  const n = sk.n;
  // Tips of order 0/1 limbs (or all tips for the old generator).
  const tips: number[] = [];
  for (let i = 1; i < n; i++) {
    if (sk.children[i] !== 0) continue;
    if (plant.order.length === n && plant.order[i] > 1) continue;
    tips.push(Math.hypot(sk.x[i], sk.y[i]));
  }
  const mean = tips.reduce((a, b) => a + b, 0) / Math.max(1, tips.length);
  const sd = Math.sqrt(tips.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, tips.length));

  let total = 0, tangential = 0, nearTotal = 0, nearBad = 0, visible = 0;
  const segs: [number, number, number, number][] = [];
  for (let i = 1; i < n; i++) {
    const pa = sk.parent[i];
    if (pa < 0) continue;
    const len = Math.hypot(sk.x[i] - sk.x[pa], sk.y[i] - sk.y[pa]);
    const mx = (sk.x[i] + sk.x[pa]) / 2, my = (sk.y[i] + sk.y[pa]) / 2;
    const [wx, wy] = toWorld(mx, my, pl);
    const [ax, ay] = toWorld(sk.x[pa], sk.y[pa], pl);
    const [bx, by] = toWorld(sk.x[i], sk.y[i], pl);
    segs.push([ax, ay, bx, by]);
    total += len;
    const hidden = blocked(wx, wy);
    if (!hidden) visible += len;
    const rr = Math.hypot(mx, my);
    if (rr < 0.12 || len < 1e-6) continue;
    const off = Math.abs(Math.atan2(Math.sin(Math.atan2(sk.x[i] - sk.x[pa], sk.y[i] - sk.y[pa]) - Math.atan2(mx, my)),
      Math.cos(Math.atan2(sk.x[i] - sk.x[pa], sk.y[i] - sk.y[pa]) - Math.atan2(mx, my))));
    if (hidden) continue;
    if (off > (60 * Math.PI) / 180) tangential += len;
    let near = false;
    for (let k = 0; k < 8 && !near; k++) {
      const a = (k / 8) * Math.PI * 2;
      if (blocked(wx + Math.cos(a) * 0.2, wy + Math.sin(a) * 0.2)) near = true;
    }
    if (near) {
      nearTotal += len;
      if (off > (35 * Math.PI) / 180) nearBad += len;
    }
  }

  let covered = 0;
  const N = 360;
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2;
    const px = pl.ox + Math.cos(a) * 1.25, py = pl.oy + Math.sin(a) * 1.25;
    for (const [ax, ay, bx, by] of segs) {
      const dx = bx - ax, dy = by - ay;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / Math.max(1e-9, dx * dx + dy * dy)));
      if (Math.hypot(ax + dx * t - px, ay + dy * t - py) < 0.04) {
        covered++;
        break;
      }
    }
  }

  return {
    outlineCoV: mean > 0 ? sd / mean : 0,
    tangentialShare: tangential / Math.max(1e-6, visible),
    hugNearSilhouette: nearBad / Math.max(1e-6, nearTotal),
    visibleShare: visible / Math.max(1e-6, total),
    coveredAt125: covered / N,
    nodes: n,
  };
}
