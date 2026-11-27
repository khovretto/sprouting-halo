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
import { TwigPool } from '../twigs';
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

/** The ending for a silence whose switch is `on` (growth.onPause, onPhraseEnd, onStop; true for a
 *  replaced tree): growth.witherEffect, from the tips or all at once (growth.witherFromTips). */
export function endActionOf(g: Params['growth'], on: boolean): EndAction {
  if (!on) return 'keep';
  const e = g.witherEffect ?? 'ungrow', tips = g.witherFromTips ?? true;
  return e === 'fade' ? (tips ? 'fadeTips' : 'fade') : e === 'fall' ? (tips ? 'fallTips' : 'fall') : 'ungrow';
}

/** What branches do in a pause or at an ending (growth.onPause, onPhraseEnd, onStop). */
export type EndAction = 'keep' | 'ungrow' | 'fadeTips' | 'fade' | 'fallTips' | 'fall';
/** One stage acting on a tree this frame: its action and how far it has come (0..1). */
export interface Wilt {
  action: EndAction;
  amount: number;
}

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
  /** growth.branchEachPhrase: build only one bough, over [a, b] (0..1) of the territory's tips;
   *  M = how many slices the territory has (a bough is at least one of them). */
  slice: [number, number, number] | null = null;
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
  /** The territory (growLo/growHi, milliradians) this tree was built for. */
  private territory = '';
  /** The node the limbs fan out from (behind the neck). */
  private hubNode = 0;

  /** The origin point (the hub) in the plant's frame. */
  originLocal(): [number, number] {
    return this.sk.n > this.hubNode ? [this.sk.x[this.hubNode], this.sk.y[this.hubNode]] : [0, 0];
  }

  /** Per-node leaf presence 0..1 (eased by decorateTree, so leaves fade in and out). */
  leafState = new Float32Array(0);
  /** Per-node blossom open amount shown (deco.ts), -1 after its petals fell. */
  bloomState = new Float32Array(0);
  /** A twig withered back (or pieces are falling) in the last computeReveal. */
  retracting = false;
  /** Leaves and petals that let go (growth.shed). */
  shed = new ShedPool();
  /** Branch pieces that broke off and fall ("fall away"). */
  twigs = new TwigPool();
  /** Segments that let go since the last drawn frame: node, how far it was grown, sim time
   *  (3 numbers each). The draw takes them over into `twigs` with their colours. */
  drops: number[] = [];
  /** Per node: 1 = it just let go and its leaf has not been dropped yet (deco.ts clears it). */
  dropped = new Uint8Array(0);
  /** Per-node: the lowest leaf density at which this node carries a leaf (2 = never). */
  leafRank = new Float32Array(0);
  private childVis = new Float32Array(0);
  /** Per-node strand phase (plants.strands: rope limbs, drawn in pushTree). */
  twistPhase = new Float32Array(0);
  /** Per node: the branch order it moves by (shaders/motion.glsl). A shoot and everything that
   *  grows from it turn as one about the shoot's base, so all of them carry the shoot's order:
   *  with its own order a sub-shoot would turn further than the shoot it sits on and come off it. */
  swing = new Uint8Array(0);
  /** Per-node distance to the farthest tip below it, used for withering. */
  private witherH = new Float32Array(0);
  /** Per-node distance to the farthest tip below it, as it is (endings reach the trunk). */
  private tipH = new Float32Array(0);
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
  /** Per branch: the flex its growing tip has reached (leaves come in a little behind it). */
  branchFront = new Float32Array(0);
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
  /** Per primary limb: the path from the root through the hub along it; `base` = arc length where
   *  the limb leaves the hub (its start), `clear` = where it leaves the avatar. */
  limbPaths: { idx: Int32Array; cum: Float32Array; length: number; clear: number; base: number }[] = [];
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
  /** Built for other shape settings (or another layout) than these: a look change. */
  isStale(pl: Placement, p: Params) {
    return this.built && this.sigOf(pl, p) !== this.signature;
  }

  /** The shape signature these settings would build (compared with the one it was built with). */
  sigOf(pl: Placement, p: Params) {
    const pp = p.plants, g = p.growth, a = p.avatar, L = p.look;
    return [
      pl.kind, Math.round(pl.sectorLo * 1000), Math.round(pl.sectorHi * 1000), pl.lengthMul ?? 1,
      g.branching, g.lowBranches, g.reach, g.flatten, g.spread, pp.lift, pp.wildness, pp.taper, pp.clearance, pp.softDroop,
      pp.moodShaping, pp.step, pp.tipWidth, pp.maxWidth, pp.maxNodes, L.decoSize, L.variety, L.depthShade,
      p.layout.midOriginY, p.layout.spinSpeed !== 0, this.slice ? this.slice.join('/') : '',
      pp.originLimbs, pp.twist, pp.twistLength, pp.gnarl, pp.knots, pp.curl, pp.twistTighten, pp.twistTwigs, pp.twistDepth, pp.strandLay, pp.twistVoice,
      a.avoid, a.headX, a.headY, a.headR, a.bodyTopY, a.bodyBottomY, a.bodyR,
    ].join('|');
  }

  ensureBuilt(pl: Placement, p: Params, blocked: Blocked, takeCount = 1, loose = false) {
    const sig = this.sigOf(pl, p);
    // growth.fillSpace: the territory to grow into (growLo / growHi) is fixed once the tree is
    // built, except while it has not shown yet (loose): then it follows, so takes that come back
    // together share the space fairly.
    const terr = Math.round((pl.growLo ?? pl.sectorLo) * 1000) + '/' + Math.round((pl.growHi ?? pl.sectorHi) * 1000);
    if (sig === this.signature && !(loose && terr !== this.territory)) return false;
    this.signature = sig;
    this.territory = terr;
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
   * segment is complete, so branches extend from their base.
   *
   * `pause` (a short pause or a pitch dip) acts on the outer twigs, within growth.witherDepth of
   * their tips; `end` (the phrase ended, or a full stop) on the whole tree, trunk and all. Each
   * has an action and an amount 0..1:
   *  - ungrow: the twigs grow back from their tips, children before their parent
   *  - fadeTips: they fade from the tips inward; fade: all of them fade together
   *  - fallTips: pieces break off from the tips inward and fall; fall: all of them at once
   * When a pause's amount recedes (singing again) the twigs regrow from their stubs.
   */
  computeReveal(reveal: number, pitch: number, p: Params, dt = 0, now = 0, pause: Wilt | null = null, end: Wilt | null = null) {
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

    const n = sk.n;
    const P = pause && pause.action !== 'keep' && pause.amount > 0 ? pause : null;
    const E = end && end.action !== 'keep' && end.amount > 0 ? end : null;
    const depth = Math.max(0.01, g.witherDepth), full = this.maxH * 1.05 + 0.02;
    const pAct = P?.action, eAct = E?.action;
    // Pause: how far in from the tips it has reached (plant units).
    const reach = P ? P.amount * depth : 0;
    const retract = (Math.max(0.05, g.witherDepth) / Math.max(0.05, g.twigFadeSeconds)) * dt; // units this frame
    // Ending by ungrowing: everything retracts, trunk and all, children first, so the whole tree
    // is gone in growth.fadeSeconds.
    const dying = eAct === 'ungrow';
    const dieStep = (full / Math.max(0.05, g.fadeSeconds)) * dt;
    const shrinkP = pAct === 'ungrow', fallP = pAct === 'fallTips' || pAct === 'fall';
    const fallE = eAct === 'fallTips' || eAct === 'fall';
    const eReach = E ? E.amount * full : 0;
    // Pieces break off a chunk at a time, each branch at its own moments.
    const CHUNK = 0.3;
    const cut = (r: number, b: number) => {
      const j = this.branchRand[b] * CHUNK;
      return Math.floor((r + j) / CHUNK) * CHUNK - j;
    };
    this.retracting = fallP || fallE;
    if (this.childVis.length < n) this.childVis = new Float32Array(n * 2);
    const cv = this.childVis;
    cv.fill(0, 0, n);
    const wh = this.witherH, th = this.tipH;
    for (let i = n - 1; i >= 0; i--) {
      const pa = sk.parent[i];
      if (dt > 0 && cv[i] <= 0 && this.vis[i] > 0) {
        const b = this.branchId[i];
        const drop = (fallE && pa >= 0 && (eAct === 'fall' || th[i] < cut(eReach, b)))
          || (fallP && wh[i] < depth && (pAct === 'fall' ? P!.amount > 0.2 : wh[i] < cut(reach, b)));
        if (drop) {
          // It lets go: drawn by the twig pool from now on (the draw picks it up from `drops`).
          if (this.drops.length < 9000) this.drops.push(i, this.vis[i], now);
          this.dropped[i] = 1;
          this.vis[i] = 0;
        } else if (dying || (shrinkP && wh[i] < reach)) {
          const seg = pa >= 0 ? Math.max(1e-3, sk.flex[i] - sk.flex[pa]) : 1;
          this.vis[i] = Math.max(0, this.vis[i] - (dying ? Math.max(dieStep, retract) : retract) / seg);
          this.retracting = true;
        }
      }
      if (pa >= 0 && this.vis[i] > cv[pa]) cv[pa] = this.vis[i];
    }
    // The root is a point: it goes with the last of the tree.
    if (fallE && dt > 0 && n > 0 && cv[0] <= 0) this.vis[0] = 0;
    const fadeP = pAct === 'fadeTips' ? Math.max(0.02, reach * 0.6) : 0.3 * depth;
    const fadeE = Math.max(0.05, 0.25 * full), eFront = E ? E.amount * (full + fadeE) : 0;
    for (let i = 0; i < n; i++) {
      // Fading twigs: in a pause the outer ones dim toward 10 % (leaves a little ahead of their
      // twig); an ending fades everything out, tips first.
      let k = 0;
      if (pAct === 'fadeTips') k = wh[i] < reach ? clamp((reach - wh[i]) / fadeP) : 0;
      else if (pAct === 'fade') k = wh[i] < depth ? P!.amount * clamp((depth - wh[i]) / fadeP) : 0;
      let life = 1 - 0.9 * k, leaf = 1 - 0.95 * clamp(k * 1.3);
      if (eAct === 'fadeTips') {
        const ke = clamp((eFront - th[i]) / fadeE);
        life *= 1 - ke;
        leaf *= 1 - clamp(ke * 1.3);
      }
      this.life[i] = life;
      this.leafLife[i] = leaf;
      // No growth where it is withering or falling.
      const held = dying || fallE || ((shrinkP || fallP) && wh[i] < reach);
      if (held && dt > 0) continue;
      // Growth toward the allowed amount, along each branch from its base.
      const pa = sk.parent[i];
      if (pa < 0) {
        // The root is a point, not a segment: it is there at once. (It used to "grow" for 0.8 s
        // with nothing to show while the reveal ran ahead, then every limb shot out together.)
        this.vis[i] = this.target[i] > 0 ? 1 : 0;
        continue;
      }
      const ready = this.vis[pa] >= 0.999;
      if (dt <= 0 || this.instant) {
        if (this.instant || !held) this.vis[i] = this.target[i]; // paused (or the wood stays): all at once
      } else if (ready && this.vis[i] < this.target[i]) {
        const seg = Math.max(1e-3, sk.flex[i] - sk.flex[pa]);
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

  private wx = new Float32Array(0);
  private wy = new Float32Array(0);
  private carry = new Float32Array(0);
  private view: Skeleton | null = null;

  /**
   * The skeleton as drawn in harmony (harmony.cross): every limb swings from side to side about
   * its own course, neighbouring limbs in opposite phase, so they cross and recross while the
   * tree keeps its outline. A side branch starts where its parent now is. `amount` 0..1; 0 returns
   * the skeleton itself.
   */
  woven(amount: number, time: number): Skeleton {
    const sk = this.sk, n = sk.n;
    if (amount <= 0.002 || n < 2) return sk;
    if (this.wx.length < n) {
      this.wx = new Float32Array(n);
      this.wy = new Float32Array(n);
    }
    const nb = this.branchRand.length;
    if (this.carry.length < nb * 3) this.carry = new Float32Array(nb * 3);
    const wx = this.wx, wy = this.wy, carry = this.carry, bid = this.branchId;
    const A = 0.05 * amount, turn = TAU / 0.55;
    wx[0] = sk.x[0];
    wy[0] = sk.y[0];
    const b0 = bid[0] * 3;
    carry[b0] = carry[b0 + 1] = carry[b0 + 2] = 0;
    for (let i = 1; i < n; i++) {
      const pa = sk.parent[i], b = bid[i], o = b * 3;
      if (bid[pa] !== b) {
        // First node of a branch: it leaves from where its parent has moved to.
        carry[o] = wx[pa] - sk.x[pa];
        carry[o + 1] = wy[pa] - sk.y[pa];
        carry[o + 2] = sk.flex[pa];
      }
      const env = clamp((sk.flex[i] - carry[o + 2]) / 0.18);
      let ox = 0, oy = 0;
      if (this.order[i] > 0) {
        const tx = sk.x[i] - sk.x[pa], ty = sk.y[i] - sk.y[pa], l = Math.hypot(tx, ty) || 1;
        const off = A * env * Math.sin(sk.flex[i] * turn + (b & 1) * Math.PI + this.branchRand[b] * 1.3 + time * 1.1);
        ox = (-ty / l) * off;
        oy = (tx / l) * off;
      }
      wx[i] = sk.x[i] + ox + carry[o] * (1 - env);
      wy[i] = sk.y[i] + oy + carry[o + 1] * (1 - env);
    }
    const view = (this.view ??= Object.create(sk) as Skeleton);
    view.x = wx;
    view.y = wy;
    return view;
  }

  /** Mark branches that have grown to their tip (once; withering does not undo it). */
  private markDone() {
    const last = this.branchLast, done = this.branchDone;
    for (let b = 0; b < done.length; b++) if (!done[b] && this.vis[last[b]] >= 0.999) done[b] = 1;
    // How far each branch has grown (its tip, as drawn).
    const sk = this.sk, fr = this.branchFront, bid = this.branchId;
    if (fr.length !== done.length) this.branchFront = new Float32Array(done.length);
    const front = this.branchFront;
    front.fill(0);
    for (let i = 1; i < sk.n; i++) {
      const v = this.vis[i];
      if (v <= 0) continue;
      const pa = sk.parent[i], f = sk.flex[pa] + v * (sk.flex[i] - sk.flex[pa]);
      if (f > front[bid[i]]) front[bid[i]] = f;
    }
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
    this.dropped = new Uint8Array(n);
    this.drops.length = 0;
    this.twigs.clear();
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
    // The territory to grow into: wider while a neighbour is away (growth.fillSpace).
    const lo0 = pl.growLo ?? pl.sectorLo, hi0 = pl.growHi ?? pl.sectorHi;
    const N = 49;
    const table = new Float32Array(N);
    for (let k = 0; k < N; k++) {
      const h = pl.angle - lerp(lo0, hi0, k / (N - 1));
      const dx = Math.sin(h), dy = Math.cos(h);
      let last = 0.2;
      for (let r = 0; r <= 1.6; r += 0.02) {
        const [wx, wy] = toWorld(cx + dx * r, cy + dy * r, pl);
        if (blocked(wx, wy)) last = r + 0.02;
      }
      table[k] = last;
    }
    const span = Math.max(1e-6, hi0 - lo0);
    const rIn = (phi: number) => {
      const x = clamp((phi - lo0) / span) * (N - 1);
      const i = Math.min(N - 2, Math.floor(x));
      return lerp(table[i], table[i + 1], x - i);
    };
    return {
      upX, upY, detail: clamp(1.25 - 0.07 * takeCount, 0.35, 1),
      hx, hy, headR: p.avatar.headR / Math.max(1e-3, pl.scale), cx, cy,
      lo: lo0, hi: hi0, mid: (lo0 + hi0) / 2, ...o, rIn,
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
    // growth.lowBranches: forks and shoots start nearer where a limb leaves the head (0 = as before).
    const low = clamp(g.lowBranches ?? 0);
    const moat = lerp(MOAT, 0.04, low);
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
      return rr >= f.rIn(phi) + moat && rr <= rOut(phi) * 1.04 && !hidden(x, y);
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
    // 1. The root is the hub behind the neck: every limb leaves from this one point. (A trunk
    //    below it, plants.trunk, is drawn once for the whole scene by main.ts, not by each tree.)
    sk.add(f.cx, f.cy, -1, 0, pp.maxWidth, NodeKind.Branch);
    const headingAt = (node: number) => {
      const pa = sk.parent[node];
      if (pa < 0) return 0;
      return Math.atan2(sk.x[node] - sk.x[pa], sk.y[node] - sk.y[pa]);
    };

    // Heading h is measured from +Y, positive toward +X: direction = (sin h, cos h).
    const grow = (parent: number, h: number, len: number, ord: number, w0: number,
                  noiseSeed: number, aim?: { x: number; y: number }, host = -1, prim = -1, steady = false): Limb => {
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
          if (!steady) {
            dh += wild * 0.25 * noise1(t * 2.5 + noiseSeed, this.seed) * ds; // wander
            dh += lift * ds * (0.3 + 0.7 * t) * Math.sin(hUp - h); // tips toward the sky
          }
        }
        h += clamp(dh, -kMax * ds, kMax * ds);
        // Safety net: a limb leaving the head's outline does so steeply.
        const dhd = Math.hypot(x - f.hx, y - f.hy);
        const leaving = Math.sin(h) * (x - f.hx) + Math.cos(h) * (y - f.hy) > 0;
        if (!steady && leaving && dhd > f.headR * 0.9 && dhd < f.headR + 0.35) {
          const hr = Math.atan2(x - f.hx, y - f.hy);
          const max = lerp(28, 70, smooth01(f.headR, f.headR + 0.35, dhd)) * deg;
          h = hr + clamp(wrap(h - hr), -max, max);
        }
        // Far out: never more than 75° off radial from the hub.
        const [rr] = polar(x, y);
        if (!steady && emerge >= 0 && rr > 0.3) {
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

    const hub = 0;
    limbs.push({ id: 0, first: 0, last: 0, order: 0, len: 0, attach: 0, emerge: 0, prim: -1 });
    this.hubNode = hub;

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
    const nTip = clamp(Math.round((sOut / gTip) * f.detail) + (mood.effort > 0.7 ? 1 : 0), this.slice ? Math.max(3, this.slice[2]) : 3, 20);
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
        // Fork in the visible part, later for deeper forks: where the gap to the neighbours has opened
        // (growth.lowBranches: soon after the limb leaves the head).
        const e = clamp(limb.emerge / Math.max(0.05, limb.len));
        const u = e + (1 - e) * clamp(lerp(lerp(0.25, 0.06, low), lerp(0.55, 0.3, low), r()) + lerp(0.08, 0.05, low) * depth,
          lerp(0.2, 0.04, low), 0.75);
        const node = limb.first + Math.round(u * (limb.last - limb.first));
        subdivide(node, side, depth + 1, sk.w[node] * 0.8, limb);
      }
    };
    // One bough (branch per phrase): only the tips of this tree's slice, as a single primary.
    // plants.originLimbs: how many limbs leave the origin (0 = by the size of the territory).
    const want = Math.round(pp.originLimbs ?? 0);
    const nPrim = !tips.length ? 0 : this.slice ? 1 : want > 0 ? clamp(want, 1, tips.length)
      : clamp(Math.round((sIn * kE) / 0.2), Math.min(2, tips.length), Math.min(tips.length, 7));
    if (this.slice && tips.length) {
      const [a, b] = this.slice;
      const from = Math.min(tips.length - 1, Math.max(0, Math.floor(a * tips.length + 1e-9)));
      const to = Math.min(tips.length, Math.max(from + 1, Math.floor(b * tips.length + 1e-9)));
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
        const e = clamp((host.emerge + lerp(0.1, 0.02, low)) / Math.max(0.05, host.len));
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
    this.tipH = Float32Array.from(height);
    this.bend = bendFrames(sk, this.order, new Float32Array(n * 4));
    this.swing = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const pa = sk.parent[i];
      this.swing[i] = this.order[i] < 2 || pa < 0 || this.order[pa] < 2 ? this.order[i] : this.swing[pa];
    }
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
          // All primaries set off together, so a young tree is a fan, not one stem.
          start[b] = 0.1 + 0.01 * Math.abs(lb.prim - (nPrim - 1) / 2);
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
      for (let i = best ? best.attach : hub; i >= 0; i = sk.parent[i]) path.unshift(i);
      if (best) for (let i = best.first; i <= best.last; i++) path.push(i);
      // Every primary's path (the fronds), in primary order.
      this.limbPaths = limbs.filter((lb) => lb.prim >= 0 && lb.last >= lb.first).sort((a, b) => a.prim - b.prim).map((lb) => {
        const trunk: number[] = [];
        for (let i = lb.attach; i >= 0; i = sk.parent[i]) trunk.unshift(i);
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
        return { idx: Int32Array.from(pth), cum, length: cum[pth.length - 1], clear, base: cum[trunk.length - 1] };
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
