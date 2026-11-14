// A previous take's plant, as a "light construct": the whole structure is built up front with
// space colonisation (Runions et al. 2007) inside the layout envelope, smoothed so branches read
// as plant limbs rather than lightning, and then *revealed* by the take's voice. Each node has a
// reveal threshold: mostly distance from the root, mixed with a per-branch random order that is
// fixed per tree (each new tree is a new seed), and steered by pitch (high notes favour the
// upper/outer side). Growth only moves forward: a revealed branch stays revealed.
//
// Everything is in the plant's local frame (origin at 0, growing along +Y); placement, spin and
// sway are applied on the GPU, so re-layout never rebuilds anything. A rebuild only happens when
// a shape setting or the envelope changes, and is fast (a few ms).

import type { Params } from '../params';
import { envelopePoint, Placement, toWorld } from '../layout';
import { clamp, lerp, rng, Rng } from '../math';

/**
 * Structure settings after the high-level growth.branching control: more branching means more,
 * closer attractors with a smaller reach and shorter steps, i.e. many short forks instead of a
 * few long limbs. The plants.* values are the fine-tuning base.
 */
export function plantShape(p: Params) {
  const b = clamp(p.growth.branching);
  const pp = p.plants;
  return {
    ...pp,
    attractors: Math.round(pp.attractors * lerp(0.6, 2.4, b)),
    influence: pp.influence * lerp(1.35, 0.6, b),
    kill: pp.kill * lerp(1.25, 0.6, b),
    step: pp.step * lerp(1.15, 0.72, b),
  };
}
import { NodeKind, Skeleton } from './skeleton';

export class Plant {
  sk = new Skeleton(1024);
  maxFlex = 1;
  /** Share of the reveal taken by the bare trunk (root to first fork, mostly behind the avatar). */
  private trunkFrac = 0;
  /** Per-node growth 0..1 along its segment (computeReveal). */
  vis = new Float32Array(0);
  /** Per-node opacity of the branch segment and of its leaves (withering). */
  life = new Float32Array(0);
  leafLife = new Float32Array(0);
  /** Per-node distance to the farthest tip below it (0 at tips); trunk nodes are far from tips. */
  private height = new Float32Array(0);
  private target = new Float32Array(0);
  /** Per-node -1..1 across the envelope (pitch steering). */
  private side = new Float32Array(0);
  private branchId = new Int32Array(0);
  private branchRand = new Float32Array(0);
  private thr = new Float32Array(0);
  private signature = '';
  private r: Rng;

  constructor(private seed: number) {
    this.r = rng(seed * 7 + 3);
  }

  /** Build (or rebuild after a shape change) for this placement's envelope. */
  ensureBuilt(pl: Placement, p: Params, blocked: (wx: number, wy: number) => boolean) {
    const pp = plantShape(p);
    const a = p.avatar;
    const sig = [
      pl.kind, pl.rMin, pl.length, pl.halfAngle, Math.round(pl.bend * 10), pl.taper, pl.ox, pl.oy,
      Math.round(pl.angle * 1000), pl.scale, pp.attractors, pp.step, pp.influence, pp.kill, pp.jitter,
      pp.smoothing, pp.tipWidth, pp.maxWidth, pp.pipeExponent, pp.maxNodes,
      a.avoid, a.headX, a.headY, a.headR, a.bodyTopY, a.bodyBottomY, a.bodyR,
    ].join('|');
    if (sig === this.signature) return false;
    this.signature = sig;
    this.build(pl, p, blocked);
    return true;
  }

  /** New random branch order (called at the start of each phrase). */
  reshuffle() {
    for (let i = 0; i < this.branchRand.length; i++) this.branchRand[i] = this.r();
  }

  /**
   * Per-node growth for this frame. `reveal` (0..1, only rises) says how much of the tree is
   * allowed; each segment then grows toward that at growth.regrowSpeed, and only once its parent
   * segment is complete, so branches extend from their base. `wither` (0..1) fades the outer twigs
   * within wither * growth.witherDepth of their tips (leaves first and further in); a twig that has
   * fully faded is cleared and grows back from its stub once the wither recedes.
   */
  computeReveal(reveal: number, pitch: number, p: Params, wither = 0, dt = 0) {
    const sk = this.sk;
    const g = p.growth;
    const variety = clamp(p.response.variety) * 0.6;
    const steer = p.response.pitchSteer * 0.35 * (pitch - 0.5) * 2;
    const band = 0.08;
    // Reveal 0 = trunk grown up to the first fork; the reveal then spreads over the canopy, so
    // growth.baseGrowth is visible branches, not just the hidden trunk.
    const level = (this.trunkFrac + reveal * (1 - this.trunkFrac)) * (1 + band);
    for (let i = 0; i < sk.n; i++) {
      let t = (sk.flex[i] / this.maxFlex) * (1 - variety) + variety * this.branchRand[this.branchId[i]];
      t = clamp(t - steer * this.side[i]);
      const pa = sk.parent[i];
      if (pa >= 0) t = Math.max(t, this.thr[pa] + 0.002);
      this.thr[i] = t;
      // Monotonic: the allowed growth only rises (pitch steering only changes what grows next).
      this.target[i] = Math.max(this.target[i], clamp((level - t) / band));
    }

    const reach = wither * Math.max(0.01, g.witherDepth);
    const leafReach = wither > 0.01 ? reach * 1.8 + 0.04 : 0;
    const twigFade = dt / Math.max(0.02, g.twigFadeSeconds);
    const leafFade = dt / Math.max(0.02, g.leafFadeSeconds);
    for (let i = 0; i < sk.n; i++) {
      // Withering: twigs fade, and once gone are cleared so they regrow later.
      if (this.height[i] < reach) {
        this.life[i] = Math.max(0, this.life[i] - twigFade);
        if (this.life[i] === 0) this.vis[i] = 0;
      } else this.life[i] = Math.min(1, this.life[i] + dt / 0.15);
      if (this.height[i] < leafReach) this.leafLife[i] = Math.max(0, this.leafLife[i] - leafFade);
      else this.leafLife[i] = Math.min(1, this.leafLife[i] + dt / 0.25);

      // Growth toward the allowed amount, along each branch from its base.
      const pa = sk.parent[i];
      const ready = pa < 0 || this.vis[pa] >= 0.999;
      if (dt <= 0) this.vis[i] = this.life[i] > 0 ? this.target[i] : 0; // paused: show the allowed growth
      else if (ready && this.life[i] > 0 && this.vis[i] < this.target[i]) {
        const seg = pa >= 0 ? Math.max(1e-3, sk.flex[i] - sk.flex[pa]) : 1;
        this.vis[i] = Math.min(this.target[i], this.vis[i] + (dt * g.regrowSpeed) / seg);
      }
    }
  }

  private build(pl: Placement, p: Params, blocked: (wx: number, wy: number) => boolean) {
    const pp = plantShape(p);
    const r = rng(this.seed);
    const sk = this.sk;
    sk.reset();
    const cell = Math.max(0.02, pp.influence);
    const grid = new Map<number, number[]>();
    const key = (cx: number, cy: number) => (cx + 32768) * 65536 + (cy + 32768);
    const addNode = (x: number, y: number, parent: number) => {
      const i = sk.add(x, y, parent, 0, pp.tipWidth, NodeKind.Branch);
      const k = key(Math.floor(x / cell), Math.floor(y / cell));
      let list = grid.get(k);
      if (!list) grid.set(k, (list = []));
      list.push(i);
      return i;
    };
    const nearest = (x: number, y: number, radius: number): [number, number] => {
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
      const reach = Math.ceil(radius / cell);
      let best = -1, bd = radius * radius;
      for (let gx = cx - reach; gx <= cx + reach; gx++)
        for (let gy = cy - reach; gy <= cy + reach; gy++) {
          const list = grid.get(key(gx, gy));
          if (!list) continue;
          for (const i of list) {
            const d = (sk.x[i] - x) ** 2 + (sk.y[i] - y) ** 2;
            if (d < bd) {
              bd = d;
              best = i;
            }
          }
        }
      return [best, best < 0 ? Infinity : Math.sqrt(bd)];
    };

    addNode(0, 0, -1);
    const ax: number[] = [], ay: number[] = [];
    for (let k = 0; k < pp.attractors; k++) {
      const [lx, ly] = envelopePoint(Math.sqrt(r()), r() * 2 - 1, pl);
      const [wx, wy] = toWorld(lx, ly, pl);
      if (!blocked(wx, wy)) {
        ax.push(lx);
        ay.push(ly);
      }
    }

    // Space colonisation, run to completion.
    let accX = new Float32Array(256), accY = new Float32Array(256);
    for (let iter = 0; iter < 800 && ax.length && sk.n < pp.maxNodes; iter++) {
      if (accX.length < sk.n) {
        accX = new Float32Array(sk.n * 2);
        accY = new Float32Array(sk.n * 2);
      }
      const touched: number[] = [];
      for (let j = ax.length - 1; j >= 0; j--) {
        const [ni, d] = nearest(ax[j], ay[j], pp.influence);
        if (ni < 0) continue;
        if (d < pp.kill) {
          ax[j] = ax[ax.length - 1];
          ay[j] = ay[ay.length - 1];
          ax.pop();
          ay.pop();
          continue;
        }
        if (accX[ni] === 0 && accY[ni] === 0) touched.push(ni);
        accX[ni] += (ax[j] - sk.x[ni]) / d;
        accY[ni] += (ay[j] - sk.y[ni]) / d;
      }
      if (!touched.length) {
        if (!ax.length) break; // the last attractors were reached this iteration
        // Nothing in reach (the trunk, or a gap): grow the closest node toward the nearest attractor.
        let aj = 0, ad = Infinity;
        for (let j = 0; j < ax.length; j++) {
          const d = ax[j] ** 2 + ay[j] ** 2;
          if (d < ad) {
            ad = d;
            aj = j;
          }
        }
        let ni = 0, nd = Infinity;
        for (let i = 0; i < sk.n; i++) {
          const d = (sk.x[i] - ax[aj]) ** 2 + (sk.y[i] - ay[aj]) ** 2;
          if (d < nd) {
            nd = d;
            ni = i;
          }
        }
        const d = Math.sqrt(nd);
        if (d < 1e-6) break;
        accX[ni] = (ax[aj] - sk.x[ni]) / d;
        accY[ni] = (ay[aj] - sk.y[ni]) / d;
        touched.push(ni);
      }
      let grew = false;
      for (const ni of touched) {
        let dx = accX[ni], dy = accY[ni];
        accX[ni] = accY[ni] = 0;
        let len = Math.hypot(dx, dy) || 1;
        dx = dx / len + (r() - 0.5) * pp.jitter;
        dy = dy / len + (r() - 0.5) * pp.jitter;
        len = Math.hypot(dx, dy) || 1;
        const nx = sk.x[ni] + (dx / len) * pp.step;
        const ny = sk.y[ni] + (dy / len) * pp.step;
        if (nearest(nx, ny, pp.step * 0.45)[0] >= 0) continue;
        addNode(nx, ny, ni);
        grew = true;
        if (sk.n >= pp.maxNodes) break;
      }
      if (!grew && touched.length === 1 && ax.length) {
        // Stuck bridging toward an unreachable attractor: drop it.
        ax.pop();
        ay.pop();
      }
    }

    sk.computeChildren();
    const n = sk.n;

    // Smoothing: relax every chain node toward the midpoint of its parent and only child, so the
    // zig-zag of the growth steps turns into a curve. Forks and tips stay put.
    const onlyChild = new Int32Array(n).fill(-1);
    for (let i = 1; i < n; i++) if (sk.children[sk.parent[i]] === 1) onlyChild[sk.parent[i]] = i;
    const nx = new Float32Array(n), ny = new Float32Array(n);
    for (let it = 0; it < pp.smoothing; it++) {
      for (let i = 0; i < n; i++) {
        const pa = sk.parent[i], c = onlyChild[i];
        if (pa >= 0 && c >= 0) {
          nx[i] = 0.5 * sk.x[i] + 0.25 * (sk.x[pa] + sk.x[c]);
          ny[i] = 0.5 * sk.y[i] + 0.25 * (sk.y[pa] + sk.y[c]);
        } else {
          nx[i] = sk.x[i];
          ny[i] = sk.y[i];
        }
      }
      sk.x.set(nx.subarray(0, n));
      sk.y.set(ny.subarray(0, n));
    }

    // Distance along the branch, pipe-model widths, branch ids, side.
    this.maxFlex = 1e-6;
    for (let i = 1; i < n; i++) {
      const pa = sk.parent[i];
      sk.flex[i] = sk.flex[pa] + Math.hypot(sk.x[i] - sk.x[pa], sk.y[i] - sk.y[pa]);
      this.maxFlex = Math.max(this.maxFlex, sk.flex[i]);
    }
    const acc = new Float32Array(n);
    for (let i = n - 1; i >= 0; i--) {
      const w = acc[i] > 0 ? Math.min(pp.maxWidth, Math.pow(acc[i], 1 / pp.pipeExponent)) : pp.tipWidth;
      sk.w[i] = w;
      const pa = sk.parent[i];
      if (pa >= 0) acc[pa] += Math.pow(w, pp.pipeExponent);
    }
    this.branchId = new Int32Array(n);
    const firstChildSeen = new Uint8Array(n);
    let branches = 1;
    let maxX = 1e-6;
    for (let i = 0; i < n; i++) maxX = Math.max(maxX, Math.abs(sk.x[i]));
    this.side = new Float32Array(n);
    for (let i = 1; i < n; i++) {
      const pa = sk.parent[i];
      if (!firstChildSeen[pa]) {
        firstChildSeen[pa] = 1;
        this.branchId[i] = this.branchId[pa];
      } else this.branchId[i] = branches++;
      // Local +X is the side the envelope bends toward (up for wings).
      this.side[i] = clamp(sk.x[i] / maxX, -1, 1) * Math.sign(pl.bend || 1);
    }
    // Trunk: follow single children from the root to the first fork.
    let node = 0;
    for (let guard = 0; guard < n; guard++) {
      if (sk.children[node] !== 1) break;
      let child = -1;
      for (let i = node + 1; i < n; i++) if (sk.parent[i] === node) { child = i; break; }
      if (child < 0) break;
      node = child;
    }
    this.trunkFrac = clamp(sk.flex[node] / this.maxFlex, 0, 0.8);
    this.branchRand = new Float32Array(branches);
    this.reshuffle();
    this.thr = new Float32Array(n);
    this.vis = new Float32Array(n);
    this.target = new Float32Array(n);
    this.life = new Float32Array(n).fill(1);
    this.leafLife = new Float32Array(n).fill(1);
    this.height = new Float32Array(n);
    for (let i = n - 1; i >= 1; i--) {
      const pa = sk.parent[i];
      const h = this.height[i] + (sk.flex[i] - sk.flex[pa]);
      if (h > this.height[pa]) this.height[pa] = h;
    }
  }
}
