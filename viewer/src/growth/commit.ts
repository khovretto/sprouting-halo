// Part B: the commit transition (docs/fable-consult.md, Part B), "crozier, staff, stamp".
//
// When a live take finishes recording, its halo becomes that take's tree:
//   0 release   the vine stops, glow swells, colour turns to the take colour
//   1 wind-up   the ring shrinks to the coil radius Rc = spine length / 2pi, travels round the head
//               to the launch point next to the tree's spine and spins into alignment
//   2 unfurl    it unrolls along the spine with arc length conserved: a straight stalk grows while
//               a shrinking coil rides at its tip
//   3 draw back the finished staff pulls back slightly and charges (and waits up to syncWindow
//               for the next onset, so the hit lands on the music)
//   4 plunge    it drives rootward into the hidden root behind the singer
//   impact      the staff *is* the spine now; flash, shock ring, quiver, leaf burst
//   5 splay     the rest of the tree grows out fast from the spine
//
// The new trees have several primary limbs instead of one spine, so the "spine" is the path from
// the root through the hub along the primary in the middle of the plant's territory
// (Plant.spineAt).
//
// State that must not depend on the frame rate (when the plunge started, when it hit, the burst)
// is advanced in step(), called from the simulation. Every pose is a pure function of time, the
// snapshot and the current placement, drawn by draw().

import type { Params } from '../params';
import type { Theme } from '../features';
import { Placement, toLocal, toWorld } from '../layout';
import { clamp, deg, hash1, lerp, RGB, TAU } from '../math';
import type { Plant } from './plant';
import { NodeKind, Skeleton } from './skeleton';

export interface HaloSnapshot {
  sk: Skeleton;
  vis: Float32Array;
  alpha: Float32Array;
  ids: Int32Array;
  /** Halo layer at the commit (world). */
  cx: number;
  cy: number;
  R: number;
  theme: Theme;
  density: number;
  /** Live colour at the commit. */
  colour: RGB;
  seed: number;
  lead: { angle: number; sign: number };
  /** Leaf size factor the halo had. */
  sizeMul: number;
  /** 0..1 how closed (idle) the halo was: the share of halo squish / tilt it had. */
  idle?: number;
  /** How the take was sung (the planted tree's character). */
  mood: { effort: number; pitch: number; soft: number; vibrato: number };
}

export interface CommitTarget {
  place: Placement;
  /** Extra rotation from spin (radians). */
  spinAngle: number;
  plant: Plant;
  layer: number;
  colour: RGB;
  /** The visible area (world): centre and half sizes. The fronds stay inside it. */
  view?: { cx: number; cy: number; hw: number; hh: number };
}

/** One frond: a piece of the ring that unrolls along primary limb k (consult 6, 2.3). */
interface Piece {
  k: number;
  /** Arc length where the limb leaves the avatar. */
  d0: number;
  /** Frond length (plant units). */
  L: number;
  /** Coil radius. */
  Rc: number;
  side: number;
  delay: number;
}

export interface StrandLook {
  colour: RGB;
  /** Multipliers on the normal look. */
  glow: number;
  width: number;
  shine: number;
  alpha: number;
}

/** Drawing callbacks provided by main.ts (they reuse pushTree / decorateTree / pushRing). */
export interface CommitHooks {
  /** Beat 0-1: the halo itself, as a ring at (cx, cy) with radius R, rotated by rot. */
  ring(snap: HaloSnapshot, cx: number, cy: number, R: number, rot: number, look: StrandLook,
       ringAlpha: number, nodeAlpha: Float32Array, windE: number): void;
  /** Beat 2+: the strand skeleton (plant-local coordinates) in the plant's layer. */
  strand(sk: Skeleton, vis: Float32Array, nodeAlpha: Float32Array, ids: Int32Array, layer: number,
         look: StrandLook, snap: HaloSnapshot, unit: number): void;
  stroke(layer: number, ax: number, ay: number, bx: number, by: number, ra: number, rb: number,
         fa: number, fb: number, look: StrandLook): void;
  /** Effects in world space (shock ring, burst). */
  fxStroke(ax: number, ay: number, bx: number, by: number, w: number, rgb: RGB, a: number, glow: number): void;
  fxSprite(x: number, y: number, angle: number, size: number, shape: number, rgb: RGB, a: number, seed: number): void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  angle: number;
  life: number;
  shape: number;
  size: number;
  seed: number;
}

// Beat lengths in seconds at duration 1.
const T = { release: 0.12, wind: 0.4, unfurl: 0.6, draw: 0.18, plunge: 0.08, splay: 0.45 };

const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeInQuad = (x: number) => x * x;
const easeOutQuad = (x: number) => 1 - (1 - x) * (1 - x);
const easeInCubic = (x: number) => x * x * x;
const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);
const smoothstep = (x: number) => x * x * (3 - 2 * x);
const mixRGB = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class CommitAnimation {
  /** Sim time of the impact, -1 before. */
  stampedAt = -1;
  /** Sim time the plunge started, -1 before. */
  plungeAt = -1;
  /** Sim time the destination vanished before impact (the strand scatters). */
  abortedAt = -1;
  done = false;

  private dir: number;
  private thetaCut: number;
  private u: Float32Array;
  private off: Float32Array;
  private anchor: Int32Array;
  private dtn: Float32Array;
  private dnn: Float32Array;
  private parent: Int32Array;
  private tmp = new Skeleton(1024);
  private nodeAlpha: Float32Array;
  private particles: Particle[] = [];
  private last?: CommitTarget;
  /** Plunge distance (plant units) and spin target, frozen at the snapshot. */
  private ringAlpha = new Float32Array(0);
  private zeroAlpha = new Float32Array(0);
  /** The fronds, frozen for the plant they were made for. */
  private pcs: Piece[] | null = null;
  private pcsPlant: Plant | null = null;
  private pieceOf = new Uint8Array(0);
  private pparent = new Int32Array(0);
  private rho1 = 0;

  constructor(readonly slotId: string, readonly snap: HaloSnapshot, readonly t0: number, private p: Params) {
    this.dir = snap.lead.sign >= 0 ? 1 : -1;
    this.thetaCut = snap.lead.angle + this.dir * 0.06; // just ahead of the leading tip
    const sk = snap.sk, n = sk.n;
    this.u = new Float32Array(n);
    this.off = new Float32Array(n);
    this.anchor = new Int32Array(n);
    this.dtn = new Float32Array(n);
    this.dnn = new Float32Array(n);
    this.parent = Int32Array.from(sk.parent.subarray(0, n));
    this.nodeAlpha = new Float32Array(n);
    this.ringAlpha = new Float32Array(n);
    this.zeroAlpha = new Float32Array(n);
    const frac = (x: number) => x - Math.floor(x);
    for (let i = 0; i < n; i++) {
      let a = i;
      while (a >= 0 && sk.kind[a] !== NodeKind.Runner) a = sk.parent[a];
      if (a < 0) a = i;
      this.anchor[i] = a;
      const th = Math.atan2(sk.y[a], sk.x[a]);
      this.u[i] = frac((this.dir * (th - this.thetaCut)) / TAU);
      this.off[i] = Math.hypot(sk.x[a], sk.y[a]) - 1;
      if (a !== i) {
        // Rigid offset from the anchor in its travel frame (ring radii).
        const tx = -Math.sin(th) * this.dir, ty = Math.cos(th) * this.dir;
        const nx = Math.cos(th), ny = Math.sin(th);
        const dx = sk.x[i] - sk.x[a], dy = sk.y[i] - sk.y[a];
        this.dtn[i] = dx * tx + dy * ty;
        this.dnn[i] = dx * nx + dy * ny;
      }
    }
    // No stroke across the cut.
    for (let i = 0; i < n; i++) {
      const pa = this.parent[i];
      if (pa >= 0 && sk.kind[i] === NodeKind.Runner && Math.abs(this.u[i] - this.u[pa]) > 0.5) this.parent[i] = -1;
    }
  }

  private get k() {
    return Math.max(0.3, this.p.commit.duration);
  }

  /** Simulation step. Returns true on the frame of the impact. */
  step(t: number, target: CommitTarget | undefined, onset: boolean): boolean {
    if (target) this.last = target;
    else if (this.stampedAt < 0 && this.abortedAt < 0) this.abortedAt = t;
    if (this.abortedAt >= 0) {
      this.done = t - this.abortedAt > 0.45;
      return false;
    }
    const c = this.p.commit, k = this.k;
    const tau = (t - this.t0) / k;
    const tReady = T.release + T.wind + T.unfurl + T.draw;
    if (this.plungeAt < 0 && tau >= tReady && (onset || !c.syncToOnset || tau >= tReady + c.syncWindow / k)) this.plungeAt = t;
    let hit = false;
    if (this.plungeAt >= 0 && this.stampedAt < 0 && (t - this.plungeAt) / (T.plunge * k) >= 1) {
      this.stampedAt = t;
      hit = true;
      if (target) this.spawnBurst(target);
    }
    if (this.stampedAt >= 0) {
      const after = t - this.stampedAt;
      this.particles = this.particles.filter((q) => after < q.life);
      this.done = after > T.splay * k + 0.7 && this.particles.length === 0;
    }
    return hit;
  }

  /** Seconds since the impact (-1 before). */
  sinceImpact(t: number) {
    return this.stampedAt < 0 ? -1 : t - this.stampedAt;
  }

  // ---- Geometry ----------------------------------------------------------------------------------

  private coilNormal(tx: number, ty: number) {
    return this.dir > 0 ? { x: -ty, y: tx } : { x: ty, y: -tx };
  }

  private Rc(target: CommitTarget) {
    return Math.max(target.plant.spineLength / TAU, 0.16 / Math.max(0.05, target.place.scale));
  }

  private look(tau: number, after: number, target: CommitTarget): StrandLook {
    const c = this.p.commit;
    const col = mixRGB(this.snap.colour, target.colour, smoothstep(clamp(tau / 0.72)));
    const tDraw = T.release + T.wind + T.unfurl;
    const charge = after < 0 ? easeOutQuad(clamp((tau - tDraw) / T.draw)) : 0;
    const release = 0.4 * easeOutQuad(clamp(tau / T.release)) * (1 - clamp((tau - T.release) / T.wind));
    const flash = after >= 0 ? Math.exp(-after / 0.12) * c.impact : 0;
    return {
      colour: col,
      glow: 1 + release + 1.2 * charge + 2 * flash,
      width: 1 + 0.3 * charge + 0.8 * flash,
      shine: Math.min(1, 0.8 * flash + 0.3 * charge),
      alpha: 1,
    };
  }

  // ---- Drawing -----------------------------------------------------------------------------------

  draw(t: number, target: CommitTarget | undefined, hooks: CommitHooks) {
    const tg = target ?? this.last;
    if (!tg) return;
    const k = this.k;
    const tau = (t - this.t0) / k;
    if (tau < 0) {
      // Staggered start: hold the ring where it was.
      this.drawRing(0, tg, hooks, 1);
      return;
    }
    if (this.abortedAt >= 0 && this.stampedAt < 0) {
      // Destination gone before impact: the strand just fades where it is.
      const fade = 1 - clamp((t - this.abortedAt) / 0.4);
      const tf = (this.abortedAt - this.t0) / k;
      if (tf < T.release) this.drawRing(tf, tg, hooks, fade);
      else this.drawFronds(this.abortedAt, tf, tg, hooks, fade);
      return;
    }
    if (tau < T.release) this.drawRing(tau, tg, hooks, 1);
    else this.drawFronds(t, tau, tg, hooks, 1);
    this.drawFx(t, tg, hooks);
  }

  /** Beats 0-1: the ring winds up and travels to the launch point. */
  private drawRing(tau: number, tg: CommitTarget, hooks: CommitHooks, fade: number) {
    const pl = tg.place, plant = tg.plant, c = this.p.commit;
    const Rc = this.Rc(tg);
    const D = c.plunge / Math.max(0.05, pl.scale);
    // Shorter wind-up when there is little distance to cover.
    const windLen = lerp(0.2, T.wind, clamp((this.snap.R - Rc * pl.scale) / 0.7));
    const e = easeInOutCubic(clamp((tau - T.release) / windLen));
    const b0 = Math.max(D, plant.rClear + Rc + 0.05);
    const sp = plant.spineAt(b0), n = this.coilNormal(sp.tx, sp.ty);
    const K0 = toWorld(sp.x + n.x * Rc, sp.y + n.y * Rc, pl, tg.spinAngle);
    const J0 = toWorld(sp.x, sp.y, pl, tg.spinAngle);
    // Travel round the head (polar about the head centre).
    const a = this.p.avatar;
    const r0 = Math.hypot(this.snap.cx - a.headX, this.snap.cy - a.headY);
    const r1 = Math.hypot(K0[0] - a.headX, K0[1] - a.headY);
    const th1 = Math.atan2(K0[1] - a.headY, K0[0] - a.headX);
    const th0 = r0 < 0.05 ? th1 : Math.atan2(this.snap.cy - a.headY, this.snap.cx - a.headX);
    const th = th0 + wrapPi(th1 - th0) * e, rr = lerp(r0, r1, e);
    const cx = a.headX + Math.cos(th) * rr, cy = a.headY + Math.sin(th) * rr;
    const R = lerp(this.snap.R * (1 + 0.04 * easeOutQuad(clamp(tau / T.release))), Rc * pl.scale, e);
    // Spin so the cut lands on the touching point, at least spinTurns in the vine's direction.
    let rho1 = wrapPi(Math.atan2(J0[1] - K0[1], J0[0] - K0[0]) - this.thetaCut);
    const minTurn = c.spinTurns * TAU;
    while (this.dir * rho1 < minTurn) rho1 += this.dir * TAU;
    const rot = rho1 * easeInQuad(clamp((tau - T.release) / windLen));
    // Ring line fades to 40 %; thin out the leaves (half let go during the wind-up).
    const keep = lerp(1, 0.5, e);
    const sk = this.snap.sk;
    for (let i = 0; i < sk.n; i++) this.ringAlpha[i] = this.snap.alpha[i] * fade * (hash1(this.snap.ids[i] * 3.7) > keep ? 1 - e : 1);
    const look = this.look(tau, -1, tg);
    look.alpha = fade;
    hooks.ring(this.snap, cx, cy, R, rot, look, lerp(1, 0.4, e) * fade, this.ringAlpha, e);
  }

  // ---- Fronds (consult 6, 2.2) ------------------------------------------------------------------

  /** Show the limbs the fronds landed on (called at the impact). */
  revealLimbs(plant: Plant) {
    for (const pc of this.pcs ?? []) plant.revealLimb(pc.k, pc.d0 + pc.L);
  }

  private pieces(tg: CommitTarget): Piece[] {
    const plant = tg.plant;
    if (this.pcs && this.pcsPlant === plant) return this.pcs;
    const P = plant.limbPaths;
    const sc = Math.max(0.05, tg.place.scale);
    const D = this.p.commit.plunge / sc, back = 0.06 / sc;
    const K = Math.max(1, Math.min(clamp(Math.round(this.p.commit.limbs), 1, 4), P.length));
    const a = this.p.avatar;
    // Evenly chosen primaries, in the vine's direction round the head, starting after the widest gap.
    const ks = [...new Set(Array.from({ length: K }, (_, j) => Math.round(((j + 0.5) * P.length) / K - 0.5)))];
    const angOf = (k: number) => {
      const q = plant.limbAt(k, P[k]?.clear ?? 0);
      const [wx, wy] = toWorld(q.x, q.y, tg.place, tg.spinAngle);
      return Math.atan2(wy - a.headY, wx - a.headX) * this.dir;
    };
    ks.sort((x, y) => angOf(x) - angOf(y));
    if (ks.length > 1) {
      let best = 0, gap = -1;
      for (let j = 0; j < ks.length; j++) {
        const prev = angOf(ks[(j + ks.length - 1) % ks.length]);
        const g = (((angOf(ks[j]) - prev) % TAU) + TAU) % TAU;
        if (g > gap) {
          gap = g;
          best = j;
        }
      }
      ks.push(...ks.splice(0, best));
    }
    const pcs = ks.map((k, m): Piece => {
      const d0 = P[k]?.clear ?? 0;
      const L = Math.max(0.25, this.fit(tg, k, d0) - D - back);
      const Rc = Math.max(L / TAU, 0.08 / sc);
      return { k, d0, L, Rc, side: this.coilSide(tg, k, d0 + D + back, Rc), delay: 0.06 * m };
    });
    // Which piece each node rides on, and no stroke between two pieces (or across the cut).
    const sk = this.snap.sk, n = sk.n;
    this.pieceOf = new Uint8Array(n);
    this.pparent = Int32Array.from(this.parent);
    for (let i = 0; i < n; i++) this.pieceOf[i] = Math.min(pcs.length - 1, Math.floor(this.u[this.anchor[i]] * pcs.length));
    for (let i = 0; i < n; i++) {
      const pa = this.pparent[i];
      if (pa >= 0 && this.pieceOf[i] !== this.pieceOf[pa]) this.pparent[i] = -1;
    }
    // Spin target: piece 0's middle faces its limb's exit point, at least spinTurns turns.
    const q0 = plant.limbAt(pcs[0].k, pcs[0].d0);
    const [ex, ey] = toWorld(q0.x, q0.y, tg.place, tg.spinAngle);
    const thMid = this.thetaCut + this.dir * (0.5 / pcs.length) * TAU;
    let rho1 = wrapPi(Math.atan2(ey - this.snap.cy, ex - this.snap.cx) - thMid);
    const minTurn = this.p.commit.spinTurns * TAU;
    while (this.dir * rho1 < minTurn) rho1 += this.dir * TAU;
    this.rho1 = rho1;
    this.pcs = pcs;
    this.pcsPlant = plant;
    return pcs;
  }

  /** Longest stretch of limb k from d0 whose world points stay inside the view (margin 0.12). */
  private fit(tg: CommitTarget, k: number, d0: number) {
    const S = tg.plant.limbPaths[k]?.length ?? 0;
    const v = tg.view ?? { cx: this.p.scene.centerX, cy: this.p.scene.centerY, hw: this.p.scene.viewRadius, hh: this.p.scene.viewRadius };
    let ok = d0;
    for (let d = d0; d <= S; d += 0.05) {
      const q = tg.plant.limbAt(k, d);
      const [wx, wy] = toWorld(q.x, q.y, tg.place, tg.spinAngle);
      if (Math.abs(wx - v.cx) > v.hw - 0.12 || Math.abs(wy - v.cy) > v.hh - 0.12) break;
      ok = d;
    }
    return ok - d0;
  }

  /** The side of limb k the coil hangs on: the one whose centre is nearer the view centre. */
  private coilSide(tg: CommitTarget, k: number, d: number, Rc: number) {
    const q = tg.plant.limbAt(k, d);
    const v = tg.view ?? { cx: this.p.scene.centerX, cy: this.p.scene.centerY, hw: 1, hh: 1 };
    const dist = (sgn: number) => {
      const [wx, wy] = toWorld(q.x - q.ty * Rc * sgn, q.y + q.tx * Rc * sgn, tg.place, tg.spinAngle);
      return Math.hypot(wx - v.cx, wy - v.cy);
    };
    return dist(1) <= dist(-1) ? 1 : -1;
  }

  /** Beats 1-5: the ring blends into K coils at the limbs' exit points, which unroll along them. */
  private drawFronds(t: number, tau: number, tg: CommitTarget, hooks: CommitHooks, fade: number) {
    const pl = tg.place, plant = tg.plant, c = this.p.commit, k = this.k;
    const pcs = this.pieces(tg), K = pcs.length;
    const sc = Math.max(0.05, pl.scale);
    const D = c.plunge / sc, back = 0.06 / sc;
    const tUnf = T.release + T.wind, tDraw = tUnf + T.unfurl;
    const e = easeInOutCubic(clamp((tau - T.release) / T.wind));
    const rot = this.rho1 * easeInQuad(clamp((tau - T.release) / T.wind));
    const plungeE = this.plungeAt < 0 ? 0 : (Math.min(t, this.stampedAt >= 0 ? this.stampedAt : t) - this.plungeAt) / (T.plunge * k);
    const after = this.stampedAt < 0 ? -1 : t - this.stampedAt;
    const drawBack = back * easeOutQuad(clamp((tau - tDraw) / T.draw));
    const unfLen = Math.max(0.1, T.unfurl - 0.06 * (K - 1));
    const sig = pcs.map((pc) => smoothstep(clamp((tau - tUnf - pc.delay) / unfLen)));

    // The ring pose (halo layer, spinning), in plant-local coordinates.
    const snap = this.snap;
    const kIdle = (snap.idle ?? 1) * (1 - e);
    const sq = 1 - clamp(this.p.halo.squish, 0, 0.95) * kIdle;
    const ringPl = { ox: snap.cx, oy: snap.cy, angle: Math.PI / 2 + rot + this.p.halo.tilt * deg * kIdle, scale: snap.R * (1.04 - 0.1 * e) } as Placement;
    const plantPl = { ...pl, angle: pl.angle + tg.spinAngle };
    const ringLocal = (lx: number, ly: number) => {
      const [wx, wy] = toWorld(lx, ly * sq, ringPl);
      return toLocal(wx, wy, plantPl);
    };

    const point = (m: number, v: number) => {
      const pc = pcs[m], sigma = sig[m];
      const nrm = (sp: { tx: number; ty: number }) => ({ x: -sp.ty * pc.side, y: sp.tx * pc.side });
      const baseAt = (vv: number) => {
        const pe = after >= 0 ? 1 : clamp(plungeE - (0.02 / T.plunge) * vv); // the tip lags: a slight stretch
        return pc.d0 + (D + drawBack) * (1 - easeInCubic(pe));
      };
      if (v <= sigma || sigma >= 0.999) {
        const d = baseAt(v) + pc.L * v, sp = plant.limbAt(pc.k, d), n = nrm(sp);
        return { x: sp.x, y: sp.y, tx: sp.tx, ty: sp.ty, nx: -n.x, ny: -n.y, flex: d * sigma, w: sp.w, Rc: pc.Rc, sigma };
      }
      const dJ = baseAt(sigma) + pc.L * sigma, sp = plant.limbAt(pc.k, dJ), n = nrm(sp);
      const q = Math.sqrt(1 - sigma), r = pc.Rc * q, om = (TAU * q * (v - sigma)) / (1 - sigma);
      const co = Math.cos(om), si = Math.sin(om);
      return {
        x: sp.x + n.x * r * (1 - co) + sp.tx * r * si, y: sp.y + n.y * r * (1 - co) + sp.ty * r * si,
        tx: sp.tx * co + n.x * si, ty: sp.ty * co + n.y * si,
        nx: sp.tx * si - n.x * co, ny: sp.ty * si - n.y * co, flex: dJ * sigma, w: sp.w, Rc: pc.Rc, sigma,
      };
    };

    const look = this.look(tau, after, tg);
    look.alpha = fade;
    // The plain ring line fades out early in the wind-up; the fronds' core lines carry on.
    if (e < 0.3) hooks.ring(snap, snap.cx, snap.cy, snap.R * (1.04 - 0.1 * e), rot, { ...look }, (1 - e / 0.3) * fade, this.zeroAlpha, e);

    const src = snap.sk, sk = this.tmp;
    sk.reset();
    const sigAvg = sig.reduce((a2, b2) => a2 + b2, 0) / K;
    const sproutFade = after < 0 ? 1 : 1 - clamp(after / 0.15);
    const runnerFade = after < 0 ? 1 : 1 - clamp(after / 0.25);
    const scaleW = 1 / sc;
    for (let i = 0; i < src.n; i++) {
      const a = this.anchor[i];
      const sprout = a !== i;
      const m = this.pieceOf[i];
      const v = this.u[a] * K - m;
      const q = point(m, clamp(v));
      const wrap = after < 0 ? lerp(1, 0.6, q.sigma) : 0.6 * (1 - clamp(after / 0.25));
      const ox = q.nx * this.off[a] * q.Rc * wrap, oy = q.ny * this.off[a] * q.Rc * wrap;
      let x = q.x + ox + (sprout ? (q.tx * this.dtn[i] + q.nx * this.dnn[i]) * q.Rc : 0);
      let y = q.y + oy + (sprout ? (q.ty * this.dtn[i] + q.ny * this.dnn[i]) * q.Rc : 0);
      if (e < 1) {
        const [rx, ry] = ringLocal(src.x[i], src.y[i]);
        x = lerp(rx, x, e);
        y = lerp(ry, y, e);
      }
      sk.add(x, y, this.pparent[i], q.flex, src.w[i] * scaleW, src.kind[i]);
      const h = hash1(snap.ids[i] * 3.7);
      const thin = e < 1 ? (h > 0.5 ? 1 - e : 1) : h > lerp(0.5, 0.45, sigAvg) ? 0 : 1;
      this.nodeAlpha[i] = snap.alpha[i] * thin * (sprout ? sproutFade : runnerFade) * fade;
    }
    sk.computeChildren();
    if (after < 0.3) hooks.strand(sk, snap.vis, this.nodeAlpha, snap.ids, tg.layer, look, snap, pl.scale);

    // Core line of each frond, until the plant's own limbs take over at the impact.
    if (after < 0) {
      const N = Math.max(12, Math.round(72 / K));
      const ringW = this.p.halo.ringWidth * scaleW;
      for (let m = 0; m < K; m++) {
        const at = (v: number) => {
          const q = point(m, v);
          if (e >= 1) return q;
          const th = this.thetaCut + this.dir * ((m + v) / K) * TAU;
          const [rx, ry] = ringLocal(Math.cos(th), Math.sin(th));
          return { ...q, x: lerp(rx, q.x, e), y: lerp(ry, q.y, e) };
        };
        const wOf = (q: { w: number; sigma: number }) => lerp(ringW, q.w, q.sigma);
        let a = at(0);
        for (let j = 1; j <= N; j++) {
          const b = at(j / N);
          hooks.stroke(tg.layer, a.x, a.y, b.x, b.y, wOf(a), wOf(b), a.flex, b.flex, look);
          a = b;
        }
      }
    }
  }

  // ---- Impact effects ----------------------------------------------------------------------------

  private spawnBurst(tg: CommitTarget) {
    const c = this.p.commit;
    const max = Math.round(c.burst);
    if (max <= 0) return;
    const sk = this.tmp, snap = this.snap;
    // Prefer shoot tips, then anything; by hash so it is stable.
    const order: number[] = [];
    for (let i = 0; i < sk.n; i++) if (this.nodeAlpha[i] > 0.05) order.push(i);
    order.sort((a, b) => {
      const ta = sk.kind[a] === NodeKind.Sprout && sk.children[a] === 0 ? 0 : 1;
      const tb = sk.kind[b] === NodeKind.Sprout && sk.children[b] === 0 ? 0 : 1;
      return ta - tb || hash1(snap.ids[a] * 1.3) - hash1(snap.ids[b] * 1.3);
    });
    const pl = tg.place;
    const [hx, hy] = [this.p.avatar.headX, this.p.layout.midOriginY];
    const shapeOf = (h: number) =>
      snap.theme === 'thorns' ? 1 : snap.theme === 'wreath' ? (h < 0.2 ? 2 : 3) : snap.theme === 'briar' ? (h < 0.35 ? 1 : 0)
        : snap.theme === 'branches' ? -1 : 0;
    for (const i of order.slice(0, max)) {
      const h = hash1(snap.ids[i] * 5.1 + 2);
      const [wx, wy] = toWorld(sk.x[i], sk.y[i], pl, tg.spinAngle);
      // Out along the tree: away from the hub, a little to either side.
      const dir = Math.atan2(wy - hy, wx - hx) + (h - 0.5) * 0.6;
      const speed = lerp(1.2, 2.8, hash1(snap.ids[i] * 7.3));
      this.particles.push({
        x: wx, y: wy, vx: Math.cos(dir) * speed, vy: Math.sin(dir) * speed,
        spin: (h - 0.5) * 8, angle: dir, life: lerp(0.45, 0.65, hash1(snap.ids[i] * 2.9)),
        shape: shapeOf(h), size: 0.07 * this.p.look.decoSize * (0.7 + 0.6 * h), seed: h,
      });
    }
  }

  private drawFx(t: number, tg: CommitTarget, hooks: CommitHooks) {
    const after = this.sinceImpact(t);
    if (after < 0) return;
    const c = this.p.commit;
    const col = mixRGB(tg.colour, [1, 1, 1], 0.5);
    // Shock ring from the root, emerging from behind the avatar.
    if (c.shockRing && c.impact > 0 && after < 0.45) {
      const e = easeOutCubic(after / 0.45);
      const R = lerp(0.3, 1.6, e) * Math.min(1.5, 0.5 + 0.5 * c.impact);
      const w = lerp(0.012, 0.003, e), a = (1 - e) * (1 - e) * Math.min(1, c.impact);
      const [ox, oy] = [tg.place.ox, tg.place.oy];
      const N = 64;
      for (let j = 0; j < N; j++) {
        const a0 = (j / N) * TAU, a1 = ((j + 1) / N) * TAU;
        hooks.fxStroke(ox + Math.cos(a0) * R, oy + Math.sin(a0) * R, ox + Math.cos(a1) * R, oy + Math.sin(a1) * R, w, col, a, 1.5);
      }
    }
    // Burst: drag 5 /s, gravity 0.3, closed form so any frame rate places them alike.
    const drag = 5, grav = 0.3;
    for (const q of this.particles) {
      if (after >= q.life) continue;
      const s = (1 - Math.exp(-drag * after)) / drag;
      const x = q.x + q.vx * s, y = q.y + q.vy * s - 0.5 * grav * after * after;
      const a = Math.pow(1 - after / q.life, 1.5);
      const ang = q.angle + q.spin * after;
      if (q.shape < 0) {
        const L = q.size * 0.6;
        hooks.fxStroke(x, y, x + Math.cos(ang) * L, y + Math.sin(ang) * L, 0.003, tg.colour, a, 1);
      } else hooks.fxSprite(x, y, ang, q.size, q.shape, tg.colour, a, q.seed);
    }
  }
}
