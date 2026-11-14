// A previous take's plant, as a "light construct": the whole structure is built up front and then
// *revealed* by the take's voice. Growth only moves forward: a revealed branch stays revealed
// (outer twigs can wither in pauses and regrow).
//
// Two generators (plants.generator):
//
// - gesture (default; docs/fable-consult.md, Part A): one dominant, nearly straight spine; a fan of
//   "feather" limbs hung off it with a wing-planform length profile (longest about a third of the
//   way out, a "hero" feather, ragged outline); then sparse twigs. Side plants carry their feathers
//   on the world-up side (growth.sweep), straight-up plants are symmetric. No envelope and no
//   routing round the avatar: near the silhouette every limb is held close to radial, so limbs
//   cross the avatar's edge steeply instead of hugging it. The reveal grows the spine first, then
//   the feathers from the root outward, then the twigs.
// - colonise: the earlier space-colonisation trees (Runions et al. 2007) inside the layout
//   envelope, kept for comparison.
//
// Everything is in the plant's local frame (root at 0, growing along +Y). Placement, spin and sway
// are applied on the GPU. A tree keeps the form it was built with: re-layout never rebuilds it
// (the next tree picks up the new form); only a shape setting change rebuilds.

import type { Params } from '../params';
import { envelopePoint, Placement, toWorld } from '../layout';
import { clamp, deg, lerp, noise1, rng, Rng } from '../math';
import { NodeKind, Skeleton } from './skeleton';

type Blocked = (wx: number, wy: number) => boolean;

/** A phrase's character, snapshotted when the tree is created (moodShaping). */
export interface Mood {
  effort: number;
  pitch: number;
  soft: number;
  vibrato: number;
}
export const NEUTRAL_MOOD: Mood = { effort: 0.5, pitch: 0.5, soft: 0, vibrato: 0 };

/**
 * Space-colonisation settings after the high-level growth.branching control (colonise generator).
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

/** Per-plant form for the gesture generator, derived once per build from the placement. */
interface PlantForm {
  kind: Placement['kind'];
  /** Spine length (plant units). */
  L: number;
  /** Widest feather divergence (radians). */
  fan: number;
  /** -1..1: local-X side that carries the feathers, and how one-sided (0 = symmetric). */
  side: number;
  /** World up in the local frame. */
  upX: number;
  upY: number;
  /** Spine arc length at which it leaves the avatar (plant units). */
  rClear: number;
  /** 0..1 complexity budget (fewer details with many takes). */
  detail: number;
  /** Avatar head centre and radius in the plant's local frame. */
  hx: number;
  hy: number;
  headR: number;
}

interface Limb {
  first: number;
  last: number;
  order: number;
  len: number;
  side: number;
  attach: number;
}

/** The avatar's head centre and radius in a plant's local frame. */
function headLocal(pl: Placement, p: Params) {
  const th = pl.angle - Math.PI / 2;
  const c = Math.cos(th), s = Math.sin(th);
  const dx = p.avatar.headX - pl.ox, dy = p.avatar.headY - pl.oy;
  const sc = Math.max(1e-3, pl.scale);
  return { hx: (c * dx + s * dy) / sc, hy: (-s * dx + c * dy) / sc, headR: p.avatar.headR / sc };
}

const smooth01 = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class Plant {
  sk = new Skeleton(1024);
  maxFlex = 1;
  /** Set by the creator before the first build (the phrase that grows this tree). */
  mood: Mood = NEUTRAL_MOOD;
  /** Share of the reveal taken by the bare trunk (hidden behind the avatar). */
  private trunkFrac = 0;
  /** Per-node growth 0..1 along its segment (computeReveal). */
  vis = new Float32Array(0);
  /** Per-node opacity of the branch segment and of its leaves (withering). */
  life = new Float32Array(0);
  leafLife = new Float32Array(0);
  /** Per-node branch order (0 spine, 1 feather, 2+ twigs) — gesture generator only. */
  order = new Uint8Array(0);
  /** Per-node distance to the farthest tip below it, used for withering. */
  private witherH = new Float32Array(0);
  private target = new Float32Array(0);
  /** Per-node -1..1 for pitch steering (gesture: world height; colonise: across the envelope). */
  private side = new Float32Array(0);
  private branchId = new Int32Array(0);
  private branchRand = new Float32Array(0);
  /** Gesture: build-time reveal threshold per node (spine, then feathers, then twigs). */
  private baseThr: Float32Array | null = null;
  private thr = new Float32Array(0);
  private signature = '';
  private r: Rng;

  /**
   * @param seed      this tree (plumage changes every generation)
   * @param slotSeed  the take (gesture: spine tilt and bow stay the same for every tree of a take)
   */
  constructor(private seed: number, private slotSeed = seed) {
    this.r = rng(seed * 7 + 3);
  }

  /**
   * Build for this placement, or rebuild after a shape setting changed. The placement's angle,
   * origin and scale are not part of the signature: re-layout never rebuilds a tree.
   * `takeCount` sets the detail budget at build time only.
   */
  ensureBuilt(pl: Placement, p: Params, blocked: Blocked, takeCount = 1) {
    const pp = p.plants, g = p.growth;
    const a = p.avatar;
    const sig = [
      pp.generator, pl.kind, pl.rMin, pl.length, pl.lengthMul ?? 1, pl.halfAngle, Math.round(pl.bend * 10), pl.taper,
      pp.attractors, pp.step, pp.influence, pp.kill, pp.jitter, pp.smoothing, pp.tipWidth, pp.maxWidth,
      pp.pipeExponent, pp.maxNodes, pp.lift, pp.wildness, pp.overlap, pp.planform, pp.taper, pp.featherSide, pp.softDroop, pp.moodShaping,
      g.branching, g.sweep, a.avoid, a.headX, a.headY, a.headR, a.bodyTopY, a.bodyBottomY, a.bodyR,
    ].join('|');
    if (sig === this.signature) return false;
    this.signature = sig;
    if (pp.generator === 'colonise') this.buildColonise(pl, p, blocked);
    else this.buildGesture(pl, p, blocked, takeCount);
    return true;
  }

  /** New random branch order. */
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
    const variety = clamp(p.response.variety);
    const steer = p.response.pitchSteer * 0.35 * (pitch - 0.5) * 2;
    const band = 0.08;
    // Reveal 0 = grown to where the plant leaves the avatar; the reveal then spreads over what is visible.
    const level = (this.trunkFrac + reveal * (1 - this.trunkFrac)) * (1 + band);
    const base = this.baseThr;
    for (let i = 0; i < sk.n; i++) {
      let t: number;
      if (base) {
        // Spine never shuffled; feathers and twigs open in a slightly varied order.
        t = base[i] + (this.order[i] > 0 ? variety * 0.3 * (this.branchRand[this.branchId[i]] - 0.5) : 0);
      } else {
        const v = variety * 0.6;
        t = (sk.flex[i] / this.maxFlex) * (1 - v) + v * this.branchRand[this.branchId[i]];
      }
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
      if (this.witherH[i] < reach) {
        this.life[i] = Math.max(0, this.life[i] - twigFade);
        if (this.life[i] === 0) this.vis[i] = 0;
      } else this.life[i] = Math.min(1, this.life[i] + dt / 0.15);
      if (this.witherH[i] < leafReach) this.leafLife[i] = Math.max(0, this.leafLife[i] - leafFade);
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

  // ---- Shared post-processing ----------------------------------------------------------------

  /** flex, maxFlex, height (distance to the farthest tip below), per-node arrays. */
  private finish(branches: number) {
    const sk = this.sk;
    const n = sk.n;
    this.maxFlex = 1e-6;
    for (let i = 1; i < n; i++) {
      const pa = sk.parent[i];
      sk.flex[i] = sk.flex[pa] + Math.hypot(sk.x[i] - sk.x[pa], sk.y[i] - sk.y[pa]);
      this.maxFlex = Math.max(this.maxFlex, sk.flex[i]);
    }
    const height = new Float32Array(n);
    for (let i = n - 1; i >= 1; i--) {
      const pa = sk.parent[i];
      const h = height[i] + (sk.flex[i] - sk.flex[pa]);
      if (h > height[pa]) height[pa] = h;
    }
    this.witherH = height;
    this.branchRand = new Float32Array(Math.max(1, branches));
    this.reshuffle();
    this.thr = new Float32Array(n);
    this.vis = new Float32Array(n);
    this.target = new Float32Array(n);
    this.life = new Float32Array(n).fill(1);
    this.leafLife = new Float32Array(n).fill(1);
    return height;
  }

  // ---- Gesture generator (Part A) ------------------------------------------------------------

  private formOf(pl: Placement, p: Params, blocked: Blocked, takeCount: number): PlantForm {
    const upX = -Math.cos(pl.angle), upY = Math.sin(pl.angle);
    // Where the plant's axis leaves the avatar silhouette.
    let rClear = 0.3;
    for (let d = 0; d <= 1.0; d += 0.03) {
      const [wx, wy] = toWorld(0, d / pl.scale, pl);
      if (blocked(wx, wy)) rClear = d / pl.scale + 0.05;
    }
    return {
      kind: pl.kind,
      L: pl.length * (pl.lengthMul ?? 1),
      fan: pl.halfAngle * deg,
      side: pl.kind === 'crown' ? 0 : clamp(p.growth.sweep * upX * 1.3, -1, 1) * (p.plants.featherSide < 0 ? -1 : 1),
      upX,
      upY,
      rClear: Math.min(rClear, 1.0),
      detail: clamp(1.25 - 0.07 * takeCount, 0.35, 1),
      ...headLocal(pl, p),
    };
  }

  private buildGesture(pl: Placement, p: Params, blocked: Blocked, takeCount: number) {
    const f = this.formOf(pl, p, blocked, takeCount);
    const mood = p.plants.moodShaping ? this.mood : NEUTRAL_MOOD;
    const pp = p.plants, g = p.growth;
    const rs = rng(this.slotSeed * 131 + 7); // gesture: stable for the take
    const r = rng(this.seed); // plumage: new every generation
    const sk = this.sk;
    sk.reset();
    const step = Math.max(0.01, pp.step);
    const wild = pp.wildness * (1 + 0.5 * mood.vibrato);
    const branching = clamp(g.branching);
    const lift = (pp.lift + 0.5 * (mood.pitch - 0.5) - 0.9 * mood.soft * pp.softDroop) * 0.9; // rad per unit
    const fan = f.fan * lerp(0.85, 1.2, mood.effort);
    const overlap = clamp(pp.overlap);
    const hUp = Math.atan2(f.upX, f.upY);

    const limbs: Limb[] = [];
    const order: number[] = [0], tAlong: number[] = [0], limbOf: number[] = [0];
    sk.add(0, 0, -1, 0, pp.maxWidth, NodeKind.Branch);

    // Heading h is measured from +Y, positive toward +X: direction = (sin h, cos h).
    const headingAt = (node: number) => {
      const pa = sk.parent[node];
      if (pa < 0) return 0;
      return Math.atan2(sk.x[node] - sk.x[pa], sk.y[node] - sk.y[pa]);
    };
    const grow = (parent: number, h: number, len: number, ord: number, curl: number, w0: number,
                  side: number, noiseSeed: number, bow = 0): Limb => {
      const n = Math.max(2, Math.ceil(len / step));
      const ds = len / n;
      let x = sk.x[parent], y = sk.y[parent], prev = parent, arc = 0;
      const first = sk.n;
      const id = limbs.length;
      const taper = clamp(pp.taper);
      const tipW = lerp(w0 * 0.75, pp.tipWidth * (ord === 0 ? 1.6 : 1), taper);
      const taperExp = lerp(2.2, 0.8, taper); // low taper: width holds, then narrows near the end
      for (let k = 1; k <= n && sk.n < pp.maxNodes; k++) {
        const t = k / n;
        arc += ds;
        // Planned recurve over the first 60 %, back toward the parent direction.
        if (t < 0.6) h += (curl * (Math.PI / 2) * Math.sin(Math.PI * (t / 0.6))) / (0.6 * n);
        if (bow && arc > f.rClear) h += bow * ds; // spine: small bow toward the feather side
        h += wild * 0.25 * noise1(t * 2.5 + noiseSeed, this.seed) * ds; // wander (gentle: more reads as lightning)
        h += lift * ds * (0.3 + 0.7 * t) * Math.sin(hUp - h); // lift toward world up
        // Anti-hugging, applied where it shows: crossing the head's outline a limb must leave
        // steeply (measured from the head centre). Hidden behind the head it is free, so limbs can
        // fork wide there and come out already splayed.
        const dh = Math.hypot(x - f.hx, y - f.hy);
        // Only for limbs on their way out (a limb heading into the head, e.g. the crown's spine
        // rising from below it, is left alone).
        const leaving = Math.sin(h) * (x - f.hx) + Math.cos(h) * (y - f.hy) > 0;
        if (leaving && dh > f.headR * 0.9 && dh < f.headR + 0.35) {
          const hr = Math.atan2(x - f.hx, y - f.hy);
          const max = lerp(28, 70, smooth01(f.headR, f.headR + 0.35, dh)) * deg;
          h = hr + clamp(wrap(h - hr), -max, max);
        }
        // Far out, never turn tangential to the plant root (no curling into a ring).
        const rr = Math.hypot(x, y);
        if (rr > f.rClear) {
          const hr = Math.atan2(x, y);
          const max = 80 * deg;
          h = hr + clamp(wrap(h - hr), -max, max);
        }
        x += Math.sin(h) * ds;
        y += Math.cos(h) * ds;
        prev = sk.add(x, y, prev, 0, lerp(w0, tipW, Math.pow(t, taperExp)), NodeKind.Branch);
        order.push(ord);
        tAlong.push(t);
        limbOf.push(id);
      }
      const limb = { first, last: sk.n - 1, order: ord, len, side, attach: parent };
      limbs.push(limb);
      return limb;
    };

    // 1. Spine: nearly straight, a seeded tilt, a small bow toward the feather side.
    const tilt = (rs() < 0.5 ? -1 : 1) * (f.kind === 'crown' ? 6 + 8 * rs() : 2 + 3 * rs()) * deg;
    const spineLen = f.L * lerp(0.95, 1.08, mood.effort) * (1 - 0.05 * (mood.pitch - 0.5) * 2);
    const spine = grow(0, tilt, spineLen, 0, 0, pp.maxWidth, 0, rs() * 10, (f.side * 12 * deg) / Math.max(0.2, spineLen));

    // 2. Feathers along the spine, with a wing planform.
    const N1 = Math.max(3, Math.round(lerp(6, 14, branching) * f.detail + (mood.effort > 0.7 ? 1 : 0)));
    const chord = f.kind === 'crown' ? 0.85 : f.kind === 'wing' ? 0.75 : 0.65;
    // Planform: 0 = pointed (longest a third of the way out, short at the tip: reads as a star or
    // triangle), 1 = broad (limbs about as long at the tip as at the base: a wide, ivy-like mass).
    const broad = clamp(pp.planform);
    const plan = (u: number) =>
      lerp(Math.pow(1 - u, 0.65) * (0.7 + 0.3 * smooth01(0, 0.3, u)), 0.85 + 0.1 * Math.sin(Math.PI * u), broad);
    const hero = Math.floor(N1 * (0.25 + 0.2 * r()));
    const firstSide = r() < 0.5 ? -1 : 1;
    const feathers: Limb[] = [];
    // Feathers attach from just inside the silhouette edge outward: attached further in, they are
    // held parallel to the spine until they emerge and read as one plume instead of a fan.
    // The crown is the exception: its limbs leave near the low root as rays behind the head and
    // shoulders (near the root the clamp allows any outward angle).
    // (Feathers attach from near the base for every plant: hidden behind the avatar they are free
    // to fork wide, so the wing branches from its start instead of ending in a tuft.)
    const uStart = f.kind === 'crown' ? 0.06 : 0.1;
    for (let j = 0; j < N1 && sk.n < pp.maxNodes; j++) {
      // Packed toward the base: more branching near the start, fewer feathers toward the tip.
      const u = lerp(uStart, 0.88, Math.pow(clamp((j + 0.5 + (r() - 0.5) * 0.6) / N1), 1.35));
      const node = spine.first + Math.round(u * (spine.last - spine.first));
      const oneSided = Math.abs(f.side) >= 0.15;
      // overlap: more feathers cross to the other side of the spine at full length, and angles vary
      // more, so limbs lie over one another instead of forming a neat comb.
      const onLift = !oneSided
        ? (j % 2 ? 1 : -1) * firstSide
        : (r() < (0.5 + 0.5 * Math.abs(f.side)) * (1 - 0.45 * overlap) ? 1 : -1) * Math.sign(f.side);
      const offSide = oneSided && onLift !== Math.sign(f.side);
      // Splayed: feathers stay wide open toward the tip, with a lot of variety between them.
      const delta = fan * lerp(1.15, 0.75, Math.pow(u, 0.9)) * (0.6 + 0.8 * r()) + (r() - 0.5) * overlap * 40 * deg;
      let len = spineLen * chord * plan(u) * (1 + wild * (r() * 0.5 - 0.25));
      if (mood.effort > 0.5) len *= 1 + 0.2 * (mood.effort - 0.5);
      if (j === hero) len *= 1.25;
      if (offSide) len *= lerp(0.35, 0.9, overlap); // the bare side: short coverts, or full feathers with overlap
      feathers.push(grow(node, headingAt(node) + onLift * delta, len, 1, -onLift * delta * 0.1,
        Math.min(sk.w[node] * 0.62, pp.maxWidth * 0.5), onLift, r() * 10));
    }

    // 3. Ivy-style side shoots: every limb throws alternating shoots at a regular spacing along
    //    its whole length, and shoots throw their own (up to three levels below the feathers).
    const shootGap = (lerp(0.26, 0.08, branching) * (1 + 0.5 * mood.soft * pp.softDroop)) / (1 + 0.3 * mood.vibrato);
    const maxOrder = branching > 0.7 ? 4 : branching > 0.35 ? 3 : 2;
    const addShoots = (host: Limb, ord: number, from: number, gapMul: number) => {
      const count = Math.floor(((host.len * (0.95 - from)) / (shootGap * gapMul)) * f.detail);
      let s = r() < 0.5 ? -1 : 1;
      for (let j = 0; j < count && sk.n < pp.maxNodes; j++) {
        const u = lerp(from, 0.95, (j + 0.5 + (r() - 0.5) * 0.5) / count);
        const node = host.first + Math.round(u * (host.last - host.first));
        const [wx, wy] = toWorld(sk.x[node], sk.y[node], pl);
        if (blocked(wx, wy)) continue; // no detail behind the avatar
        s = -s; // alternate sides, like ivy
        const len = Math.max(0.05, host.len * lerp(0.45, 0.25, u) * (0.7 + 0.6 * r()) * (ord > 2 ? 0.8 : 1));
        const shoot = grow(node, headingAt(node) + s * (32 + 25 * r()) * deg, len, ord, (r() - 0.5) * 0.4,
          Math.min(sk.w[node] * 0.75, pp.tipWidth * 1.8), s, r() * 10);
        if (ord < maxOrder && len > 0.12 && r() < lerp(0.3, 0.85, branching) * f.detail) addShoots(shoot, ord + 1, 0.2, 1.2);
      }
    };
    for (const ft of feathers) addShoots(ft, 2, 0.15, 1);
    // The main stem throws shoots of its own between the feathers, outside the avatar.
    addShoots(spine, 2, Math.min(0.9, f.rClear / Math.max(0.05, spineLen)), 1.6);

    sk.computeChildren();
    const n = sk.n;
    this.order = Uint8Array.from(order.slice(0, n));
    this.branchId = Int32Array.from(limbOf.slice(0, n));
    const height = this.finish(limbs.length);

    // Withering: the spine never withers, feather stubs hold a little longer than twigs.
    for (let i = 0; i < n; i++) this.witherH[i] = height[i] + (this.order[i] === 0 ? 99 : this.order[i] === 1 ? 0.12 : 0);

    // Reveal schedule: spine first (to 42 %), then each child branch starts a little after its
    // attachment point and takes longer the longer it is; then normalise.
    const start = new Float32Array(limbs.length), span = new Float32Array(limbs.length);
    span[0] = 0.42;
    const thr = new Float32Array(n);
    for (let i = 1; i < n; i++) {
      const b = this.branchId[i], lb = limbs[b];
      if (i === lb.first && b > 0) {
        start[b] = thr[lb.attach] + 0.04 + 0.1 * lb.order;
        span[b] = 0.3 * Math.sqrt(lb.len / Math.max(0.05, spineLen));
      }
      thr[i] = start[b] + span[b] * tAlong[i];
    }
    let maxThr = 1e-6;
    for (let i = 0; i < n; i++) maxThr = Math.max(maxThr, thr[i]);
    for (let i = 0; i < n; i++) thr[i] /= maxThr;
    this.baseThr = thr;
    const clearNode = spine.first + Math.round(clamp(f.rClear / Math.max(0.05, spineLen)) * (spine.last - spine.first));
    this.trunkFrac = clamp(thr[Math.min(n - 1, Math.max(0, clearNode))], 0, 0.6);

    // Pitch steering by world height: high notes open the higher limbs first.
    let lo = Infinity, hi = -Infinity;
    const hgt = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      hgt[i] = sk.x[i] * f.upX + sk.y[i] * f.upY;
      lo = Math.min(lo, hgt[i]);
      hi = Math.max(hi, hgt[i]);
    }
    const mid = (lo + hi) / 2, half = Math.max(1e-3, (hi - lo) / 2);
    this.side = new Float32Array(n);
    for (let i = 0; i < n; i++) this.side[i] = clamp((hgt[i] - mid) / half, -1, 1);
  }

  // ---- Colonise generator (previous trees) ---------------------------------------------------

  private buildColonise(pl: Placement, p: Params, blocked: Blocked) {
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
        if (!ax.length) break;
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
        ax.pop();
        ay.pop();
      }
    }

    sk.computeChildren();
    const n = sk.n;
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

    // Pipe-model widths and branch ids.
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
    for (let i = 1; i < n; i++) {
      const pa = sk.parent[i];
      if (!firstChildSeen[pa]) {
        firstChildSeen[pa] = 1;
        this.branchId[i] = this.branchId[pa];
      } else this.branchId[i] = branches++;
    }
    this.order = new Uint8Array(n);
    this.finish(branches);
    let maxX = 1e-6;
    for (let i = 0; i < n; i++) maxX = Math.max(maxX, Math.abs(sk.x[i]));
    this.side = new Float32Array(n);
    for (let i = 1; i < n; i++) this.side[i] = clamp(sk.x[i] / maxX, -1, 1) * Math.sign(pl.bend || 1);
    this.baseThr = null;

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
  }
}
