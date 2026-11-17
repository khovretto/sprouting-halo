// A previous take's plant, as a "light construct": the whole structure is built up front and then
// *revealed* by the take's voice. Growth only moves forward: a revealed branch stays revealed
// (outer twigs can wither in pauses and regrow).
//
// Hub, territory and sector subdivision (docs/fable-consult-2.md, section 2):
// - Every plant grows from one hub behind the neck and ends on one shared, flattened outline (a
//   superellipse about the hub, layout.outlineOf). Each plant fills its own angular territory of the
//   band between the avatar's silhouette and that outline, so several plants read as one wide
//   canopy that cradles the avatar.
// - Tip targets are placed evenly along the outline first. A few primary limbs leave the hub
//   radially (straight while hidden, so they cross the silhouette steeply), then home to their
//   targets and fork on the way out; each fork takes a share of its parent's tips. The number of
//   limbs therefore rises with distance and the density stays level: nothing bunches.
// - Ivy shoots are only spawned into free space: a shoot probes a few directions on an occupancy
//   grid, takes the freest, and stops short of other branches (plants.clearance).
// - A moat: no shoot or leaf comes within 0.08 of the silhouette. Only limbs cross it, steeply, so
//   the foliage holds the avatar at an even distance without anything hugging it.
//
// Everything is in the plant's local frame (root at 0, growing along +Y). Placement, spin and sway
// are applied on the GPU. Re-layout never rebuilds a tree; a change of territory (take count) or of
// a shape setting does.

import { ShedPool } from '../shed';
import type { Params } from '../params';
import { outlineOf, Placement, rOutAt, toLocal, toWorld } from '../layout';
import { clamp, deg, hash1, lerp, noise1, rng, Rng } from '../math';
import { bendFrames, NodeKind, Skeleton } from './skeleton';

type Blocked = (wx: number, wy: number) => boolean;

/** A phrase's character, snapshotted when the tree is created (moodShaping). */
export interface Mood {
  effort: number;
  pitch: number;
  soft: number;
  vibrato: number;
}
export const NEUTRAL_MOOD: Mood = { effort: 0.5, pitch: 0.5, soft: 0, vibrato: 0 };

interface PlantForm {
  /** World up in the local frame. */
  upX: number;
  upY: number;
  /** 0..1 complexity budget (fewer details with many takes). */
  detail: number;
  /** Avatar head (local). */
  hx: number;
  hy: number;
  headR: number;
  /** Hub (local). */
  cx: number;
  cy: number;
  /** Territory (world radians) and its middle. */
  lo: number;
  hi: number;
  mid: number;
  /** Outline half-width / top / bottom (plant units). */
  a: number;
  b: number;
  bDown: number;
  /** Silhouette radius from the hub (plant units) at a world angle. */
  rIn: (phi: number) => number;
}

interface Limb {
  id: number;
  first: number;
  last: number;
  /** 0 trunk, 1 limb or fork, 2 shoot, 3 sub-shoot. */
  order: number;
  len: number;
  attach: number;
  /** Arc length at which it left the silhouette (0 if it started outside). */
  emerge: number;
  /** Index among the primaries, -1 otherwise. */
  prim: number;
  /** Last node including a curled tip (appended after everything else; plants.curl). */
  end?: number;
}

const smooth01 = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

const TAU = Math.PI * 2;
const CELL = 0.06; // occupancy cell (two steps)
const MOAT = 0.08; // gap between silhouette and foliage

export class Plant {
  sk = new Skeleton(1024);
  maxFlex = 1;
  /** Set by the creator before the first build (the phrase that grows this tree). */
  mood: Mood = NEUTRAL_MOOD;
  /** growth.branchEachPhrase: build only one bough, in slice [j, of M] of the territory. */
  slice: [number, number] | null = null;
  /** Share of the reveal taken by the hidden part (trunk, primaries behind the avatar). */
  private trunkFrac = 0;
  /** Per-node growth 0..1 along its segment (computeReveal). */
  vis = new Float32Array(0);
  /** Per-node opacity of the branch segment and of its leaves (withering). */
  life = new Float32Array(0);
  leafLife = new Float32Array(0);
  /** Per-node branch order (0 trunk, 1 limbs and forks, 2 shoots, 3 sub-shoots). */
  order = new Uint8Array(0);
  /** Per-node brightness: dim inside, bright at the rim, plus per-limb variety. */
  tone = new Float32Array(0);
  /** Per node: pivot x, y, flex and heading of the shoot it belongs to (motion; bendFrames). */
  bend = new Float32Array(0);
  /** Per node: seconds until a fallen leaf grows back (look.leafFall); 0 = the leaf is there. */
  leafGone = new Float32Array(0);
  /** look.woodStays: every segment shows at once (no growing). */
  instant = false;
  /** Per-node leaf presence 0..1 (eased by decorateTree, so leaves fade in and out). */
  leafState = new Float32Array(0);
  /** Per-node blossom open amount shown (deco.ts), -1 after its petals fell. */
  bloomState = new Float32Array(0);
  /** A twig withered back in the last computeReveal. */
  retracting = false;
  /** Leaves and petals that let go (growth.shed). */
  shed = new ShedPool();
  /** Per-node: the lowest leaf density at which this node carries a leaf (2 = never). */
  leafRank = new Float32Array(0);
  private childVis = new Float32Array(0);
  /** Per-node strand phase (plants.strands: rope limbs, drawn in pushTree). */
  twistPhase = new Float32Array(0);
  /** Per node: the branch turns sharply here (twist elbows): its segment keeps a round end. */
  elbow = new Uint8Array(0);
  /** Per-node distance to the farthest tip below it, used for withering. */
  private witherH = new Float32Array(0);
  /** Distance from the root to the farthest tip (the whole tree's height, for dying back). */
  private maxH = 0;
  private target = new Float32Array(0);
  /** Per-node -1..1 world height (pitch steering). */
  private side = new Float32Array(0);
  /** Per node: the branch (limb, fork or shoot) it belongs to. */
  branchId = new Int32Array(0);
  /** Per branch: its last node, and 1 once it has finished growing (leaves are only drawn then). */
  private branchLast = new Int32Array(0);
  branchDone = new Uint8Array(0);
  private branchRand = new Float32Array(0);
  /** Build-time reveal threshold per node. */
  private baseThr = new Float32Array(0);
  private thr = new Float32Array(0);
  private signature = '';
  /** Built at least once (a new tree may wait a frame for its turn to build). */
  get built() {
    return this.signature !== '';
  }
  private r: Rng;
  /** One path per primary limb, in primary order: root -> hub -> that primary (the planting
   *  animation's fronds, consult 6, 2.3). `clear`: arc length where it leaves the avatar. */
  limbPaths: { idx: Int32Array; cum: Float32Array; length: number; clear: number }[] = [];
  /** The spine (Part B commit): root -> hub -> the territory's middle primary limb. */
  private spine = new Int32Array(0);
  private spineCum = new Float32Array(0);
  spineLength = 0;
  /** Arc length along the spine where it leaves the avatar. */
  rClear = 0;
  /** Multiplier on growth.regrowSpeed (the commit stamp's growth burst). */
  boost = 1;

  /**
   * @param seed      this tree (limbs and plumage change every generation)
   * @param slotSeed  the take (the hero tip stays the same for every tree of a take)
   */
  constructor(private seed: number, private slotSeed = seed) {
    this.r = rng(seed * 7 + 3);
  }

  /**
   * Build for this placement, or rebuild after a shape setting or the territory changed. The
   * placement's angle, origin and scale are not part of the signature: re-layout never rebuilds.
   */
  ensureBuilt(pl: Placement, p: Params, blocked: Blocked, takeCount = 1) {
    const pp = p.plants, g = p.growth, a = p.avatar, L = p.look;
    const sig = [
      pl.kind, Math.round(pl.sectorLo * 1000), Math.round(pl.sectorHi * 1000), pl.lengthMul ?? 1,
      g.branching, g.reach, g.flatten, g.spread, pp.lift, pp.wildness, pp.taper, pp.clearance, pp.softDroop,
      pp.moodShaping, pp.step, pp.tipWidth, pp.maxWidth, pp.maxNodes, L.decoSize, L.variety, L.depthShade,
      p.layout.midOriginY, p.layout.spinSpeed !== 0, this.slice ? this.slice.join('/') : '',
      pp.twist, pp.twistLength, pp.gnarl, pp.knots, pp.curl, pp.twistTighten, pp.twistTwigs, pp.twistDepth, pp.strandLay, pp.twistVoice,
      a.avoid, a.headX, a.headY, a.headR, a.bodyTopY, a.bodyBottomY, a.bodyR,
    ].join('|');
    if (sig === this.signature) return false;
    this.signature = sig;
    this.buildGesture(pl, p, blocked, takeCount);
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
   * fully faded is cleared and grows back from its stub once the wither recedes. `die` > 0: the
   * whole tree withers back to the root (growth.ending), however deep growth.witherDepth is.
   */
  computeReveal(reveal: number, pitch: number, p: Params, wither = 0, dt = 0, die = 0) {
    const sk = this.sk;
    const g = p.growth;
    const variety = clamp(p.response.variety);
    const steer = p.response.pitchSteer * 0.35 * (pitch - 0.5) * 2;
    const band = 0.08;
    // Reveal 0 = grown to where the plant leaves the avatar; the reveal then spreads over what is visible.
    const level = (this.trunkFrac + reveal * (1 - this.trunkFrac)) * (1 + band);
    const base = this.baseThr;
    for (let i = 0; i < sk.n; i++) {
      let t = base[i] + (this.order[i] > 0 ? variety * 0.3 * (this.branchRand[this.branchId[i]] - 0.5) : 0);
      t = clamp(t - steer * this.side[i]);
      const pa = sk.parent[i];
      if (pa >= 0) t = Math.max(t, this.thr[pa] + 0.002);
      this.thr[i] = t;
      // Monotonic: the allowed growth only rises (pitch steering only changes what grows next).
      this.target[i] = Math.max(this.target[i], clamp((level - t) / band));
    }

    // Withering: the outer twigs within `reach` of their tips grow *back* (retract from the tip,
    // their leaves shrinking with them), so a withered tree looks younger, never dead: no faded
    // bare twigs. Children retract before their parent. When the wither recedes they regrow.
    // growth.ending "fade": the outer twigs stay and fade instead; "both": they fade as they retract.
    const ending = g.ending ?? 'wither';
    const shrink = ending !== 'fade', dim = ending !== 'wither';
    const reach = wither * Math.max(0.01, g.witherDepth);
    const retract = (Math.max(0.05, g.witherDepth) / Math.max(0.05, g.twigFadeSeconds)) * dt; // units this frame
    // Dying (a long silence, or a replaced tree): everything retracts, trunk and all, children
    // first, so the whole tree is gone in growth.fadeSeconds.
    const dying = die > 0 && shrink;
    const dieStep = ((this.maxH * 1.05 + 0.02) / Math.max(0.05, g.fadeSeconds)) * dt;
    const n = sk.n;
    this.retracting = false;
    if (this.childVis.length < n) this.childVis = new Float32Array(n * 2);
    const cv = this.childVis;
    cv.fill(0, 0, n);
    for (let i = n - 1; i >= 0; i--) {
      const pa = sk.parent[i];
      if (dt > 0 && cv[i] <= 0 && this.vis[i] > 0 && (dying || (shrink && this.witherH[i] < reach))) {
        const seg = pa >= 0 ? Math.max(1e-3, sk.flex[i] - sk.flex[pa]) : 1;
        this.vis[i] = Math.max(0, this.vis[i] - (dying ? Math.max(dieStep, retract) : retract) / seg);
        this.retracting = true;
      }
      if (pa >= 0 && this.vis[i] > cv[pa]) cv[pa] = this.vis[i];
    }
    const fadeIn = Math.max(0.02, reach * 0.6);
    for (let i = 0; i < n; i++) {
      // Fading twigs: the outer ones dim toward 10 % (leaves a little ahead of their twig).
      const k = dim && reach > 0 && this.witherH[i] < reach ? clamp((reach - this.witherH[i]) / fadeIn) : 0;
      this.life[i] = 1 - 0.9 * k;
      this.leafLife[i] = 1 - 0.95 * clamp(k * 1.3);
      if (dying || (shrink && this.witherH[i] < reach && dt > 0)) continue; // withering: no growth here
      // Growth toward the allowed amount, along each branch from its base.
      const pa = sk.parent[i];
      if (pa < 0) {
        // The root is a point, not a segment: it is there at once. (It used to "grow" for 0.8 s
        // with nothing to show while the reveal ran ahead, then every limb shot out together.)
        this.vis[i] = this.target[i] > 0 ? 1 : 0;
        continue;
      }
      const ready = pa < 0 || this.vis[pa] >= 0.999;
      if (dt <= 0 || this.instant) {
        if (this.instant || !shrink || this.witherH[i] >= reach) this.vis[i] = this.target[i]; // paused (or the wood stays): all at once
      } else if (ready && this.vis[i] < this.target[i]) {
        const seg = pa >= 0 ? Math.max(1e-3, sk.flex[i] - sk.flex[pa]) : 1;
        this.vis[i] = Math.min(this.target[i], this.vis[i] + (dt * g.regrowSpeed * this.boost) / seg);
      }
    }
    this.markDone();
  }

  /** look.leafFall: each leaf that is there lets go with `rate` per second (it falls: decorateTree
   *  sees leafGone and sheds it), and grows back after about `regrow` seconds. */
  fallLeaves(dt: number, rate: number, regrow: number) {
    const gone = this.leafGone, ls = this.leafState, n = Math.min(gone.length, ls.length);
    if (dt <= 0) return;
    const pr = 1 - Math.exp(-Math.max(0, rate) * dt);
    for (let i = 0; i < n; i++) {
      if (gone[i] > 0) gone[i] = Math.max(0, gone[i] - dt);
      else if (pr > 0 && ls[i] > 0.9 && Math.random() < pr) gone[i] = Math.max(0.3, regrow) * (0.6 + 0.8 * Math.random());
    }
  }

  /** Mark branches that have grown to their tip (once; withering does not undo it). */
  private markDone() {
    const last = this.branchLast, done = this.branchDone;
    for (let b = 0; b < done.length; b++) if (!done[b] && this.vis[last[b]] >= 0.999) done[b] = 1;
  }

  /** Point, unit tangent and width at arc length d along the spine (extended straight past both ends). */
  spineAt(d: number) {
    const sk = this.sk, sp = this.spine, cum = this.spineCum, m = sp.length;
    if (m < 2) return { x: 0, y: d, tx: 0, ty: 1, w: this.sk.w[0] ?? 0.01 };
    let k = 0;
    if (d >= cum[m - 1]) k = m - 2;
    else if (d > 0) {
      let lo = 0, hi = m - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] <= d) lo = mid;
        else hi = mid;
      }
      k = lo;
    }
    const a = sp[k], b = sp[k + 1];
    const len = Math.max(1e-6, cum[k + 1] - cum[k]);
    const tx = (sk.x[b] - sk.x[a]) / len, ty = (sk.y[b] - sk.y[a]) / len;
    const u = (d - cum[k]) / len;
    const w = sk.w[a] + (sk.w[b] - sk.w[a]) * Math.min(1, Math.max(0, u));
    return { x: sk.x[a] + tx * (d - cum[k]), y: sk.y[a] + ty * (d - cum[k]), tx, ty, w };
  }

  /** Point, unit tangent and width at arc length d along limb path k, clamped to the path (no
   *  straight extension past its ends). */
  limbAt(k: number, d: number) {
    const P = this.limbPaths[k], sk = this.sk;
    if (!P || P.idx.length < 2) return { x: 0, y: d, tx: 0, ty: 1, w: sk.w[0] ?? 0.01 };
    const cum = P.cum, m = P.idx.length;
    d = clamp(d, 0, P.length);
    let lo = 0, hi = m - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= d) lo = mid;
      else hi = mid;
    }
    const a = P.idx[lo], b = P.idx[lo + 1];
    const len = Math.max(1e-6, cum[lo + 1] - cum[lo]);
    const tx = (sk.x[b] - sk.x[a]) / len, ty = (sk.y[b] - sk.y[a]) / len;
    const u = clamp((d - cum[lo]) / len);
    return { x: sk.x[a] + tx * (d - cum[lo]), y: sk.y[a] + ty * (d - cum[lo]), tx, ty, w: sk.w[a] + (sk.w[b] - sk.w[a]) * u };
  }

  /** Show limb path k at once up to arc length upTo (a frond landed on it). */
  revealLimb(k: number, upTo: number) {
    const P = this.limbPaths[k];
    if (!P) return;
    for (let j = 0; j < P.idx.length && P.cum[j] <= upTo; j++) {
      const i = P.idx[j];
      this.vis[i] = this.target[i] = 1;
      this.life[i] = 1;
    }
    this.markDone();
  }

  /** Show the whole spine at once (the strand that landed on it is now it). */
  revealSpine() {
    for (const i of this.spine) {
      this.vis[i] = this.target[i] = 1;
      this.life[i] = 1;
    }
    this.markDone();
  }

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
    this.maxH = 0;
    for (let i = 0; i < n; i++) this.maxH = Math.max(this.maxH, height[i]);
    this.branchRand = new Float32Array(Math.max(1, branches));
    this.reshuffle();
    this.thr = new Float32Array(n);
    this.vis = new Float32Array(n);
    this.target = new Float32Array(n);
    this.life = new Float32Array(n).fill(1);
    this.leafLife = new Float32Array(n).fill(1);
    this.leafState = new Float32Array(n);
    this.leafGone = new Float32Array(n);
    this.bloomState = new Float32Array(n);
    this.shed.clear();
    return height;
  }

  // ---- Form ------------------------------------------------------------------------------------

  private formOf(pl: Placement, p: Params, blocked: Blocked, takeCount: number, mood: Mood): PlantForm {
    const upX = -Math.cos(pl.angle), upY = Math.sin(pl.angle);
    const [cx, cy] = toLocal(p.avatar.headX, p.layout.midOriginY, pl);
    const [hx, hy] = toLocal(p.avatar.headX, p.avatar.headY, pl);
    const o = outlineOf(p, lerp(0.95, 1.08, mood.effort), pl.lengthMul ?? 1);
    // A world angle phi is the local heading pl.angle - phi; direction = (sin h, cos h).
    const N = 49;
    const table = new Float32Array(N);
    for (let k = 0; k < N; k++) {
      const h = pl.angle - lerp(pl.sectorLo, pl.sectorHi, k / (N - 1));
      const dx = Math.sin(h), dy = Math.cos(h);
      let last = 0.2;
      for (let r = 0; r <= 1.6; r += 0.02) {
        const [wx, wy] = toWorld(cx + dx * r, cy + dy * r, pl);
        if (blocked(wx, wy)) last = r + 0.02;
      }
      table[k] = last;
    }
    const span = Math.max(1e-6, pl.sectorHi - pl.sectorLo);
    const rIn = (phi: number) => {
      const x = clamp((phi - pl.sectorLo) / span) * (N - 1);
      const i = Math.min(N - 2, Math.floor(x));
      return lerp(table[i], table[i + 1], x - i);
    };
    return {
      upX, upY, detail: clamp(1.25 - 0.07 * takeCount, 0.35, 1),
      hx, hy, headR: p.avatar.headR / Math.max(1e-3, pl.scale), cx, cy,
      lo: pl.sectorLo, hi: pl.sectorHi, mid: (pl.sectorLo + pl.sectorHi) / 2, ...o, rIn,
    };
  }

  // ---- Generator ---------------------------------------------------------------------------------

  private buildGesture(pl: Placement, p: Params, blocked: Blocked, takeCount: number) {
    const mood = p.plants.moodShaping ? this.mood : NEUTRAL_MOOD;
    const f = this.formOf(pl, p, blocked, takeCount, mood);
    const pp = p.plants, g = p.growth;
    const rs = rng(this.slotSeed * 131 + 7); // stable for the take
    const r = rng(this.seed); // new every generation
    const sk = this.sk;
    sk.reset();
    const step = Math.max(0.01, pp.step);
    const wild = pp.wildness * (1 + 0.5 * mood.vibrato);
    const branching = clamp(g.branching);
    const lift = (pp.lift + 0.5 * (mood.pitch - 0.5) - 0.9 * mood.soft * pp.softDroop) * 0.9; // rad per unit
    const hUp = Math.atan2(f.upX, f.upY);

    const rOut = (phi: number) => rOutAt(phi, f);
    const hOf = (phi: number) => pl.angle - phi; // world angle -> local heading
    /** Polar position about the hub: [radius, world angle unwrapped around the territory's middle]. */
    const polar = (x: number, y: number): [number, number] => {
      const phi = pl.angle - Math.atan2(x - f.cx, y - f.cy);
      return [Math.hypot(x - f.cx, y - f.cy), f.mid + wrap(phi - f.mid)];
    };
    const hidden = (x: number, y: number) => {
      const [wx, wy] = toWorld(x, y, pl);
      return blocked(wx, wy);
    };

    // Occupancy: which limb claimed each cell first.
    const occ = new Map<number, number>();
    const key = (x: number, y: number) => (Math.floor(x / CELL) + 32768) * 65536 + (Math.floor(y / CELL) + 32768);
    const claim = (x: number, y: number, id: number) => {
      const k = key(x, y);
      if (!occ.has(k)) occ.set(k, id);
    };
    const taken = (x: number, y: number, self: number, host: number) => {
      const o = occ.get(key(x, y));
      return o !== undefined && o !== self && o !== host;
    };
    // Shoots may spill a little past the territory's edge, so neighbouring plants interleave.
    const seam = 0.04 + 0.16 * clamp(pp.overlap);
    /** May a shoot or leaf be here? Inside the band, outside the moat, not hidden. */
    const inBand = (x: number, y: number) => {
      const [rr, phi] = polar(x, y);
      if (phi < f.lo - seam || phi > f.hi + seam) return false;
      return rr >= f.rIn(phi) + MOAT && rr <= rOut(phi) * 1.04 && !hidden(x, y);
    };
    /** Free here, with `clearance` to both sides of the direction of travel. */
    const free = (x: number, y: number, h: number, self: number, host: number) => {
      if (!inBand(x, y)) return false;
      const nx = Math.cos(h) * pp.clearance, ny = -Math.sin(h) * pp.clearance;
      return !taken(x, y, self, host) && !taken(x + nx, y + ny, self, host) && !taken(x - nx, y - ny, self, host);
    };
    /** How far a shoot could run from (x, y) along heading h before it meets something. */
    const freeRun = (x: number, y: number, h: number, max: number, host: number) => {
      let d = 1.5 * CELL; // skip the host's own cells at the base
      for (; d < max; d += CELL / 2) if (!free(x + Math.sin(h) * d, y + Math.cos(h) * d, h, -1, host)) break;
      return d;
    };

    const limbs: Limb[] = [];
    const order: number[] = [0], tAlong: number[] = [0], limbOf: number[] = [0];
    sk.add(0, 0, -1, 0, pp.maxWidth, NodeKind.Branch);
    const headingAt = (node: number) => {
      const pa = sk.parent[node];
      if (pa < 0) return 0;
      return Math.atan2(sk.x[node] - sk.x[pa], sk.y[node] - sk.y[pa]);
    };

    // Heading h is measured from +Y, positive toward +X: direction = (sin h, cos h).
    const grow = (parent: number, h: number, len: number, ord: number, w0: number,
                  noiseSeed: number, aim?: { x: number; y: number }, host = -1, prim = -1): Limb => {
      const n = Math.max(2, Math.ceil(len / step));
      const ds = len / n;
      let x = sk.x[parent], y = sk.y[parent], prev = parent, arc = 0;
      const first = sk.n, id = limbs.length;
      const taper = clamp(pp.taper);
      const tipW = lerp(w0 * 0.75, pp.tipWidth, taper);
      const taperExp = lerp(2.2, 0.8, taper);
      const kMax = ord >= 2 ? 10 : 6; // turn-rate cap: no kinks
      let emerge = hidden(x, y) ? -1 : 0; // -1 = still behind the avatar
      for (let k = 1; k <= n && sk.n < pp.maxNodes; k++) {
        const t = k / n;
        arc += ds;
        let dh = 0;
        if (emerge >= 0) {
          if (aim) {
            // Homing: ramps in after leaving the silhouette, tightens near the target.
            const rem = Math.hypot(aim.x - x, aim.y - y);
            if (rem < ds) break;
            const w = smooth01(emerge + 0.05, emerge + 0.3, arc);
            dh += wrap(Math.atan2(aim.x - x, aim.y - y) - h) * clamp((1.6 * ds) / Math.max(rem, 0.2), 0, 0.5) * w;
          }
          dh += wild * 0.25 * noise1(t * 2.5 + noiseSeed, this.seed) * ds; // wander
          dh += lift * ds * (0.3 + 0.7 * t) * Math.sin(hUp - h); // tips toward the sky
        }
        h += clamp(dh, -kMax * ds, kMax * ds);
        // Safety net: a limb leaving the head's outline does so steeply.
        const dhd = Math.hypot(x - f.hx, y - f.hy);
        const leaving = Math.sin(h) * (x - f.hx) + Math.cos(h) * (y - f.hy) > 0;
        if (leaving && dhd > f.headR * 0.9 && dhd < f.headR + 0.35) {
          const hr = Math.atan2(x - f.hx, y - f.hy);
          const max = lerp(28, 70, smooth01(f.headR, f.headR + 0.35, dhd)) * deg;
          h = hr + clamp(wrap(h - hr), -max, max);
        }
        // Far out: never more than 75° off radial from the hub.
        const [rr] = polar(x, y);
        if (emerge >= 0 && rr > 0.3) {
          const hr = Math.atan2(x - f.cx, y - f.cy);
          h = hr + clamp(wrap(h - hr), -75 * deg, 75 * deg);
        }
        const nx = x + Math.sin(h) * ds, ny = y + Math.cos(h) * ds;
        if (ord >= 2 && !free(nx, ny, h, id, host)) break; // shoots stop at claimed space
        x = nx;
        y = ny;
        if (emerge < 0 && !hidden(x, y)) emerge = arc;
        prev = sk.add(x, y, prev, 0, lerp(w0, tipW, Math.pow(t, taperExp)), NodeKind.Branch);
        order.push(ord);
        tAlong.push(t);
        limbOf.push(id);
        if (emerge >= 0) claim(x, y, id);
      }
      const limb: Limb = { id, first, last: sk.n - 1, order: ord, len, attach: parent, emerge: Math.max(0, emerge), prim };
      limbs.push(limb);
      return limb;
    };

    // 1. Hidden trunk: root -> hub (the crown only; for wings and wedges the hub is the root).
    let hub = 0;
    const trunkLen = Math.hypot(f.cx, f.cy);
    if (trunkLen > 2 * step) hub = grow(0, Math.atan2(f.cx, f.cy), trunkLen, 0, pp.maxWidth, 0).last;
    else limbs.push({ id: 0, first: 0, last: 0, order: 0, len: 0, attach: 0, emerge: 0, prim: -1 });

    // 2. Tip targets: evenly spaced along the outline, stratified jitter, ragged radius.
    const W = f.hi - f.lo;
    const usable = (phi: number) => f.rIn(phi) < 0.7 * rOut(phi); // not a direction behind the body
    let sOut = 0, sIn = 0;
    for (let k = 0; k < 24; k++) {
      const phi = f.lo + (W * (k + 0.5)) / 24;
      if (usable(phi)) {
        sOut += (rOut(phi) * W) / 24;
        sIn += (f.rIn(phi) * W) / 24;
      }
    }
    const gTip = lerp(0.6, 0.28, branching);
    const nTip = clamp(Math.round((sOut / gTip) * f.detail) + (mood.effort > 0.7 ? 1 : 0), this.slice ? Math.max(3, this.slice[1]) : 3, 20);
    const kE = clamp(1.05 - 0.4 * g.spread * lerp(0.85, 1.2, mood.effort), 0.3, 1);
    const hero = Math.floor(nTip * (0.25 + 0.5 * rs()));
    const droop = 8 * deg * mood.soft * pp.softDroop;
    interface Tip { phiE: number; x: number; y: number }
    const tips: Tip[] = [];
    for (let i = 0; i < nTip; i++) {
      let phiT = f.lo + (W * (i + 0.5 + (r() - 0.5) * 0.35)) / nTip;
      phiT += Math.cos(phiT) >= 0 ? -droop : droop; // soft singing: both halves turn away from the top
      phiT = clamp(phiT, f.lo, f.hi);
      if (!usable(phiT)) continue;
      const rag = (1 - 0.28 * wild * r()) * (i % 2 ? 0.92 : 1) * (i === hero ? 1.06 : 1);
      const R = Math.max(f.rIn(phiT) + 0.35, rOut(phiT) * rag);
      const hT = hOf(phiT);
      tips.push({ phiE: f.mid + (phiT - f.mid) * kE, x: f.cx + Math.sin(hT) * R, y: f.cy + Math.cos(hT) * R });
    }

    // 3. Sector subdivision: each limb takes the middle tip of its group and hands the tips on
    //    either side to forks that leave it further out.
    const wPrim = pp.maxWidth * 0.42;
    const branchLimbs: Limb[] = [];
    const subdivide = (start: number, group: Tip[], depth: number, w0: number, parentLimb: Limb | null, prim = -1) => {
      if (!group.length || sk.n >= pp.maxNodes) return;
      const m = Math.min(group.length - 1, Math.max(0, Math.floor(group.length / 2 + (r() - 0.5) * 0.6)));
      const main = group[m];
      const chord = Math.hypot(main.x - sk.x[start], main.y - sk.y[start]);
      let h0: number;
      if (!parentLimb) h0 = hOf(main.phiE); // primary: radial from the hub
      else {
        const turn = wrap(Math.atan2(main.x - sk.x[start], main.y - sk.y[start]) - headingAt(start));
        h0 = headingAt(start) + Math.sign(turn || 1) * clamp(Math.abs(turn) * 0.8, 22 * deg, 55 * deg);
      }
      const limb = grow(start, h0, chord * 1.08, 1, w0, r() * 10, { x: main.x, y: main.y }, -1, prim);
      branchLimbs.push(limb);
      for (const side of [group.slice(0, m), group.slice(m + 1)]) {
        if (!side.length || limb.last < limb.first) continue;
        // Fork in the visible part, later for deeper forks: where the gap to the neighbours has opened.
        const e = clamp(limb.emerge / Math.max(0.05, limb.len));
        const u = e + (1 - e) * clamp(lerp(0.25, 0.55, r()) + 0.08 * depth, 0.2, 0.75);
        const node = limb.first + Math.round(u * (limb.last - limb.first));
        subdivide(node, side, depth + 1, sk.w[node] * 0.8, limb);
      }
    };
    // One bough (branch per phrase): only the tips of this tree's slice, as a single primary.
    const nPrim = !tips.length ? 0 : this.slice ? 1 : clamp(Math.round((sIn * kE) / 0.2), Math.min(2, tips.length), Math.min(tips.length, 7));
    if (this.slice && tips.length) {
      const [j, M] = this.slice;
      const from = Math.min(tips.length - 1, Math.floor((j * tips.length) / M));
      const to = Math.max(from + 1, Math.floor(((j + 1) * tips.length) / M));
      subdivide(hub, tips.slice(from, to), 0, wPrim, null, 0);
    } else
      for (let k = 0; k < nPrim; k++) {
        const from = Math.round((k * tips.length) / nPrim), to = Math.round(((k + 1) * tips.length) / nPrim);
        subdivide(hub, tips.slice(from, to), 0, wPrim, null, k);
      }

    // 4. Ivy shoots, placed into free space. All limbs exist before any shoot does, and spawn
    //    sites are visited in a shuffled order so no limb takes all the room first.
    const shootGap = (lerp(0.22, 0.09, branching) * (1 + 0.5 * mood.soft * pp.softDroop)) / (1 + 0.3 * mood.vibrato);
    const shootMax = lerp(0.16, 0.34, branching);
    const maxDepth = branching > 0.5 ? 2 : 1;
    const CANDS = [55, 40, 72].map((d) => d * deg);
    const shootRound = (hosts: Limb[], ord: number, gapMul: number): Limb[] => {
      const sites: { host: Limb; node: number; side: number; u: number; key: number }[] = [];
      for (const host of hosts) {
        if (host.last < host.first) continue;
        const e = clamp((host.emerge + 0.1) / Math.max(0.05, host.len));
        const count = Math.floor(((host.len * Math.max(0, 0.95 - e)) / (shootGap * gapMul)) * f.detail);
        let s = r() < 0.5 ? -1 : 1;
        for (let j = 0; j < count; j++) {
          const u = lerp(e, 0.95, (j + 0.5 + (r() - 0.5) * 0.5) / count);
          s = -s; // alternate, like ivy
          sites.push({ host, node: host.first + Math.round(u * (host.last - host.first)), side: s, u, key: r() });
        }
      }
      sites.sort((pa, qa) => pa.key - qa.key);
      const made: Limb[] = [];
      for (const st of sites) {
        if (sk.n >= pp.maxNodes) break;
        const x = sk.x[st.node], y = sk.y[st.node], hb = headingAt(st.node);
        if (!inBand(x, y)) continue; // nothing in the moat or behind the avatar
        const want = shootMax * (0.7 + 0.6 * r()) * lerp(1, 0.6, st.u) * (ord > 2 ? 0.7 : 1);
        // Preferred side first; the other side only if the preferred one is crowded.
        let best = 0, bestH = 0;
        for (const sgn of [st.side, -st.side]) {
          for (const c of CANDS) {
            const run = freeRun(x, y, hb + sgn * c, want + pp.clearance, st.host.id);
            if (run > best) {
              best = run;
              bestH = hb + sgn * c;
            }
          }
          if (best >= want * 0.6) break;
        }
        const len = Math.min(want, best - pp.clearance);
        if (len < 0.07) continue; // crowded: no shoot here
        made.push(grow(st.node, bestH, len, ord, Math.min(sk.w[st.node] * 0.6, pp.tipWidth * 1.2), r() * 10, undefined, st.host.id));
      }
      return made;
    };
    let hosts = branchLimbs;
    for (let d = 0; d < maxDepth; d++) hosts = shootRound(hosts, 2 + d, d === 0 ? 1 : 1.2).filter((l) => l.len > 0.14);

    // 4b. Twist (docs/fable-consult-7-twist.md, 1.3): a post-pass that only moves x, y and w. Tips,
    //     hub, hidden part, topology and reveal order stay; every later step reads the moved nodes,
    //     so decorations, limbPaths and the fronds agree. Off (0) = skipped, its own random stream.
    const tw = clamp(pp.twist * (1 + pp.twistVoice * (0.6 * mood.vibrato + 0.5 * (mood.effort - 0.5))), 0, 1.5);
    const gn = clamp(pp.gnarl), n0 = sk.n;
    this.twistPhase = new Float32Array(pp.maxNodes + 1);
    this.elbow = new Uint8Array(pp.maxNodes + 1);
    const depthOf = new Float32Array(pp.maxNodes + 1);
    const rt = rng(this.seed * 977 + 11);
    if (tw > 0 || pp.knots > 0 || pp.strands > 1) {
      const x0 = sk.x.slice(0, n0), y0 = sk.y.slice(0, n0);
      const offX = new Float32Array(n0), offY = new Float32Array(n0), phiA = new Float32Array(n0);
      const AMP = [0, 0.05, 0.032, 0.022]; // by order, at twist = 1
      for (const lb of limbs) {
        if (lb.last < lb.first) continue;
        const ord = Math.min(3, lb.order), at = lb.attach;
        let Lb = 0;
        for (let i = lb.first; i <= lb.last; i++) {
          const q = i === lb.first ? at : i - 1;
          Lb += Math.hypot(x0[i] - x0[q], y0[i] - y0[q]);
        }
        const A0 = Math.min(AMP[ord] * tw * (ord >= 2 ? pp.twistTwigs : 1), 0.16 * Lb);
        const ramp = Math.min(0.12, 0.35 * Lb);
        const thetaMax = ord >= 2 ? 0.3 : 0.22;
        const sgn = rt() < 0.5 ? -1 : 1, ns = rt() * 100;
        let ph = phiA[at] + (ord >= 2 ? Math.PI * rt() : 0), psi = this.twistPhase[at], s = 0;
        for (let i = lb.first; i <= lb.last; i++) {
          const q = i === lb.first ? at : i - 1, nx = i < lb.last ? i + 1 : i;
          const ds = Math.max(1e-5, Math.hypot(x0[i] - x0[q], y0[i] - y0[q]));
          s += ds;
          const t = s / Math.max(1e-6, Lb);
          let tx = x0[nx] - x0[q], ty = y0[nx] - y0[q];
          const tl = Math.hypot(tx, ty) || 1;
          tx /= tl;
          ty /= tl; // rest tangent; normal = (ty, -tx)
          const lam = Math.max(8 * ds, pp.twistLength * (ord >= 2 ? 0.6 : 1) * lerp(1, 0.45, pp.twistTighten * t)
            * Math.exp(0.7 * gn * noise1(s * 4 + ns, this.seed)));
          ph += (TAU * ds) / lam;
          let E = hidden(x0[i], y0[i]) ? 0 : smooth01(lb.emerge, lb.emerge + ramp, s);
          if (ord < 2) E *= smooth01(0, ramp, Lb - s); // limb tips stay on their targets
          const A = Math.min(A0, (thetaMax * lam * lam) / (4 * Math.PI * Math.PI * ds)) * E
            * (1 + 0.6 * gn * noise1(s * 6 + ns + 31, this.seed));
          const sn = Math.sin(ph);
          const m = sgn * lerp(sn, (2 / Math.PI) * Math.asin(sn), 0.8 * gn); // sine -> elbows
          const carry = ord >= 2 ? 1 : 1 - smooth01(0, 1, t);
          let dx = offX[at] * carry + ty * A * m, dy = offY[at] * carry - tx * A * m;
          const band = inBand(x0[i], y0[i]), hid = hidden(x0[i], y0[i]);
          for (let k = 0; k < 3; k++) {
            // full, half, none: never into the moat or behind the avatar
            const ok = band ? inBand(x0[i] + dx, y0[i] + dy) : hid || !hidden(x0[i] + dx, y0[i] + dy);
            if (ok) break;
            dx = k < 1 ? dx / 2 : 0;
            dy = k < 1 ? dy / 2 : 0;
          }
          offX[i] = dx;
          offY[i] = dy;
          phiA[i] = ph;
          sk.x[i] = x0[i] + dx;
          sk.y[i] = y0[i] + dy;
          depthOf[i] = E * Math.cos(ph) * (A0 > 0 ? 1 : 0);
          // Strand phase: one turn per strandLay branch widths (a rope's lay), never under 4 nodes.
          psi += (TAU * ds) / Math.max(pp.strandLay * 2 * sk.w[i], 4 * ds);
          this.twistPhase[i] = psi;
          sk.w[i] *= 1 + 0.45 * pp.knots * E * Math.pow(Math.abs(sn), 6); // knots at the crests
        }
      }
      // Knots where a fork leaves a limb (not at every twig: that would thicken the whole limb).
      if (pp.knots > 0)
        for (const lb of limbs)
          if (lb.order === 1 && lb.prim < 0 && lb.last >= lb.first) {
            sk.w[lb.attach] *= 1 + 0.5 * pp.knots;
            if (sk.parent[lb.attach] > 0) sk.w[sk.parent[lb.attach]] *= 1 + 0.25 * pp.knots;
          }
      // Elbows: in and out directions differ by more than 0.3 rad.
      for (let i = 1; i < n0 - 1; i++) {
        const pa = sk.parent[i], c = i + 1;
        if (pa < 0 || sk.parent[c] !== i) continue;
        const a = Math.atan2(sk.x[i] - sk.x[pa], sk.y[i] - sk.y[pa]), b = Math.atan2(sk.x[c] - sk.x[i], sk.y[c] - sk.y[i]);
        if (Math.abs(wrap(b - a)) > 0.3) this.elbow[i] = 1;
      }
    }

    // 4c. Curling tips: a shrinking spiral appended to limb tips and some twig ends (new nodes at
    //     the end, so no index moves; Limb.last stays the last contiguous node).
    if (pp.curl > 0) {
      const attached = new Set(limbs.map((l) => l.attach));
      let budget = Math.min(pp.maxNodes - sk.n, Math.floor(0.2 * pp.maxNodes));
      for (const lb of limbs) {
        if (budget <= 0) break;
        if (lb.order < 1 || lb.last < lb.first || attached.has(lb.last)) continue;
        if (lb.order >= 2 && (lb.len < 0.12 || rt() > 0.25 + 0.5 * pp.curl)) continue;
        const i0 = lb.last, pa = sk.parent[i0];
        if (pa < 0) continue;
        let h = Math.atan2(sk.x[i0] - sk.x[pa], sk.y[i0] - sk.y[pa]);
        // Limb tips curl back toward the hub, so the outline is kept. Twigs: either way.
        const sgn = lb.order === 1 ? Math.sign(wrap(Math.atan2(f.cx - sk.x[i0], f.cy - sk.y[i0]) - h)) || 1 : rt() < 0.5 ? -1 : 1;
        const r0 = (lb.order === 1 ? 0.05 : 0.032) * (0.8 + 0.4 * rt()); // first radius
        const total = TAU * pp.curl * lerp(0.6, 1.4, rt()); // up to 1.4 turns
        const dth = 0.45, m = Math.ceil(total / dth);
        let x = sk.x[i0], y = sk.y[i0], prev = i0, arc = 0;
        for (let k = 1; k <= m && budget > 0; k++) {
          const u = k / m, ds = r0 * (1 - 0.7 * u) * dth; // the radius shrinks to 30 %
          h += sgn * dth;
          x += Math.sin(h) * ds;
          y += Math.cos(h) * ds;
          arc += ds;
          if (!inBand(x, y) || taken(x, y, lb.id, limbOf[lb.attach])) break;
          prev = sk.add(x, y, prev, 0, sk.w[i0] * (1 - 0.5 * u), NodeKind.Branch);
          order.push(lb.order);
          tAlong.push(1 + arc / Math.max(0.05, lb.len));
          limbOf.push(lb.id);
          this.twistPhase[prev] = this.twistPhase[i0];
          claim(x, y, lb.id);
          budget--;
        }
        if (prev !== i0) lb.end = prev;
      }
    }

    // 5. Per-node arrays.
    sk.computeChildren();
    const n = sk.n;
    this.order = Uint8Array.from(order.slice(0, n));
    this.branchId = Int32Array.from(limbOf.slice(0, n));
    this.branchLast = Int32Array.from(limbs.map((l) => l.end ?? (l.last >= l.first ? l.last : l.attach)));
    const height = this.finish(limbs.length);
    this.branchDone = new Uint8Array(limbs.length);
    this.bend = bendFrames(sk, this.order, new Float32Array(n * 4));
    // Pause withering never reaches the trunk (dying does: computeReveal); limbs hold a little longer than shoots.
    for (let i = 0; i < n; i++) this.witherH[i] = height[i] + (this.order[i] === 0 ? 99 : this.order[i] === 1 ? 0.12 : 0);

    // 6. Reveal schedule: trunk, then the primaries from the territory's middle outward, then
    //    forks and shoots after their attachment point.
    const start = new Float32Array(limbs.length), span = new Float32Array(limbs.length);
    span[0] = 0.1;
    const thr = new Float32Array(n);
    const aRef = Math.max(0.1, f.a);
    for (let i = 1; i < n; i++) {
      const b = this.branchId[i], lb = limbs[b];
      if (i === lb.first && b > 0) {
        if (lb.prim >= 0) {
          start[b] = 0.1 + 0.05 * Math.abs(lb.prim - (nPrim - 1) / 2);
          span[b] = 0.45 * Math.sqrt(lb.len / aRef);
        } else if (lb.order === 1) {
          start[b] = thr[lb.attach] + 0.03;
          span[b] = 0.45 * Math.sqrt(lb.len / aRef);
        } else {
          start[b] = thr[lb.attach] + 0.04 + 0.06 * (lb.order - 2);
          span[b] = 0.3 * Math.sqrt(lb.len / aRef);
        }
      }
      thr[i] = start[b] + span[b] * tAlong[i];
    }
    let maxThr = 1e-6;
    for (let i = 0; i < n; i++) maxThr = Math.max(maxThr, thr[i]);
    for (let i = 0; i < n; i++) thr[i] /= maxThr;
    this.baseThr = thr;
    let tf = 0.6;
    for (const lb of limbs) {
      if (lb.prim < 0) continue;
      for (let i = lb.first; i <= lb.last; i++)
        if (!hidden(sk.x[i], sk.y[i])) {
          tf = Math.min(tf, thr[i]);
          break;
        }
    }
    this.trunkFrac = clamp(tf, 0, 0.6);

    // Spine for the commit animation: trunk + the primary nearest the territory's middle.
    {
      let best: Limb | undefined;
      for (const lb of limbs)
        if (lb.prim >= 0 && lb.last >= lb.first && (!best || Math.abs(lb.prim - (nPrim - 1) / 2) < Math.abs(best.prim - (nPrim - 1) / 2))) best = lb;
      const path: number[] = [];
      for (let i = hub; i >= 0; i = sk.parent[i]) path.unshift(i);
      if (best) for (let i = best.first; i <= best.last; i++) path.push(i);
      // Every primary's path (the fronds), in primary order.
      const trunk: number[] = [];
      for (let i = hub; i >= 0; i = sk.parent[i]) trunk.unshift(i);
      this.limbPaths = limbs.filter((lb) => lb.prim >= 0 && lb.last >= lb.first).sort((a, b) => a.prim - b.prim).map((lb) => {
        const pth = [...trunk];
        for (let i = lb.first; i <= lb.last; i++) pth.push(i);
        const cum = new Float32Array(pth.length);
        for (let k = 1; k < pth.length; k++) cum[k] = cum[k - 1] + Math.hypot(sk.x[pth[k]] - sk.x[pth[k - 1]], sk.y[pth[k]] - sk.y[pth[k - 1]]);
        let clear = cum[pth.length - 1] * 0.4;
        for (let k = 0; k < pth.length; k++)
          if (!hidden(sk.x[pth[k]], sk.y[pth[k]])) {
            clear = cum[k];
            break;
          }
        return { idx: Int32Array.from(pth), cum, length: cum[pth.length - 1], clear };
      });
      this.spine = Int32Array.from(path);
      this.spineCum = new Float32Array(path.length);
      for (let k = 1; k < path.length; k++)
        this.spineCum[k] = this.spineCum[k - 1] + Math.hypot(sk.x[path[k]] - sk.x[path[k - 1]], sk.y[path[k]] - sk.y[path[k - 1]]);
      this.spineLength = path.length ? this.spineCum[path.length - 1] : 0;
      this.rClear = this.spineLength * 0.4;
      for (let k = 0; k < path.length; k++)
        if (!hidden(sk.x[path[k]], sk.y[path[k]])) {
          this.rClear = this.spineCum[k];
          break;
        }
    }

    // 7. Pitch steering by world height: high notes open the higher limbs first.
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

    // 8. Tone: dim inside, bright at the rim, with per-limb variety.
    const variety = clamp(p.look.variety), depthShade = clamp(p.look.depthShade);
    const limbTone = limbs.map(() => 1 + 0.14 * (r() * 2 - 1) * variety);
    this.tone = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const [rr, phi] = polar(sk.x[i], sk.y[i]);
      const rIn = f.rIn(phi);
      const rho = clamp((rr - rIn) / Math.max(0.1, rOut(phi) - rIn));
      this.tone[i] = lerp(lerp(1, 0.6, depthShade), 1.08, rho * rho * (3 - 2 * rho)) * limbTone[this.branchId[i]];
      this.tone[i] *= 1 + 0.22 * pp.twistDepth * depthOf[i]; // twist: the near half of each turn is brighter
    }

    // 9. Leaf ranks: blue-noise placement with a guaranteed spacing. leafRank[i] is the lowest
    //    density at which node i carries a leaf, so the per-track density works at draw time and
    //    never makes leaves jump.
    const L0 = 0.055 * p.look.decoSize;
    const LEVELS = [2.6, 2.0, 1.55, 1.2, 0.95, 0.75, 0.6].map((k) => k * L0);
    this.leafRank = new Float32Array(n).fill(2);
    const cand: number[] = [];
    for (let i = 1; i < n; i++) if (this.order[i] >= 1 && inBand(sk.x[i], sk.y[i])) cand.push(i);
    const pri = (i: number) => (sk.children[i] === 0 ? 0 : 1) + hash1(i * 3.7 + this.seed); // terminals first
    cand.sort((pa, qa) => pri(pa) - pri(qa));
    const cellL = LEVELS[0];
    const placed = new Map<number, number[]>();
    const pk = (gx: number, gy: number) => (gx + 32768) * 65536 + (gy + 32768);
    const nearerThan = (x: number, y: number, d: number) => {
      const gx = Math.floor(x / cellL), gy = Math.floor(y / cellL);
      for (let ix = gx - 1; ix <= gx + 1; ix++)
        for (let iy = gy - 1; iy <= gy + 1; iy++) {
          const list = placed.get(pk(ix, iy));
          if (!list) continue;
          for (const j of list) if (Math.hypot(sk.x[j] - x, sk.y[j] - y) < d) return true;
        }
      return false;
    };
    LEVELS.forEach((d, lv) => {
      for (const i of cand) {
        if (this.leafRank[i] < 2 || nearerThan(sk.x[i], sk.y[i], d)) continue;
        this.leafRank[i] = (lv + hash1(i * 5.3 + this.seed)) / LEVELS.length;
        const k = pk(Math.floor(sk.x[i] / cellL), Math.floor(sk.y[i] / cellL));
        let list = placed.get(k);
        if (!list) placed.set(k, (list = []));
        list.push(i);
      }
    });
  }
}
