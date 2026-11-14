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
import { Placement, toWorld } from '../layout';
import { clamp, hash1, lerp, RGB, TAU } from '../math';
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
    const tUnf = T.release + T.wind;
    if (this.abortedAt >= 0 && this.stampedAt < 0) {
      // Destination gone before impact: the strand just fades where it is.
      const fade = 1 - clamp((t - this.abortedAt) / 0.4);
      const tf = (this.abortedAt - this.t0) / k;
      if (tf < tUnf) this.drawRing(tf, tg, hooks, fade);
      else this.drawStrand(this.abortedAt, tf, tg, hooks, fade);
      return;
    }
    if (tau < tUnf) this.drawRing(tau, tg, hooks, 1);
    else this.drawStrand(t, tau, tg, hooks, 1);
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

  /** Beats 2-5: the strand in the plant's own layer. */
  private drawStrand(t: number, tau: number, tg: CommitTarget, hooks: CommitHooks, fade: number) {
    const pl = tg.place, plant = tg.plant, c = this.p.commit, k = this.k;
    const S = Math.max(0.2, plant.spineLength);
    const Rc = this.Rc(tg);
    const D = c.plunge / Math.max(0.05, pl.scale);
    const tUnf = T.release + T.wind, tDraw = tUnf + T.unfurl;
    const sigma = smoothstep(clamp((tau - tUnf) / T.unfurl));
    const plungeE = this.plungeAt < 0 ? 0 : (Math.min(t, this.stampedAt >= 0 ? this.stampedAt : t) - this.plungeAt) / (T.plunge * k);
    const after = this.stampedAt < 0 ? -1 : t - this.stampedAt;
    const drawBack = (0.06 / Math.max(0.05, pl.scale)) * easeOutQuad(clamp((tau - tDraw) / T.draw));
    const b0 = Math.max(D, plant.rClear + Rc + 0.05);
    const baseAt = (u: number) => {
      const pe = after >= 0 ? 1 : clamp(plungeE - (0.02 / T.plunge) * u); // the tip lags: a slight stretch
      return lerp(b0, D, sigma) + drawBack - (D + drawBack) * easeInCubic(pe);
    };
    const swayIn = sigma;
    const wrap = after < 0 ? lerp(1, 0.6, sigma) : 0.6 * (1 - clamp(after / 0.25));
    // Squeeze a strand longer than the spine (tiny destinations) onto it.
    const point = (u: number) => {
      if (u <= sigma || sigma >= 0.999) {
        const d = baseAt(u) + S * u, sp = plant.spineAt(d), n = this.coilNormal(sp.tx, sp.ty);
        return { x: sp.x, y: sp.y, tx: sp.tx, ty: sp.ty, nx: -n.x, ny: -n.y, flex: d * swayIn, w: sp.w };
      }
      const dJ = baseAt(sigma) + S * sigma, sp = plant.spineAt(dJ), n = this.coilNormal(sp.tx, sp.ty);
      const q = Math.sqrt(1 - sigma), r = Rc * q, om = (TAU * q * (u - sigma)) / (1 - sigma);
      const co = Math.cos(om), si = Math.sin(om);
      return {
        x: sp.x + n.x * r * (1 - co) + sp.tx * r * si, y: sp.y + n.y * r * (1 - co) + sp.ty * r * si,
        tx: sp.tx * co + n.x * si, ty: sp.ty * co + n.y * si,
        nx: sp.tx * si - n.x * co, ny: sp.ty * si - n.y * co, flex: dJ * swayIn, w: sp.w,
      };
    };

    const look = this.look(tau, after, tg);
    look.alpha = fade;
    const snap = this.snap, src = snap.sk, sk = this.tmp;
    sk.reset();
    const keep = lerp(0.5, 0.45, sigma);
    const sproutFade = after < 0 ? 1 : 1 - clamp(after / 0.15);
    const runnerFade = after < 0 ? 1 : 1 - clamp(after / 0.25);
    const scaleW = 1 / Math.max(0.05, pl.scale);
    for (let i = 0; i < src.n; i++) {
      const a = this.anchor[i];
      const sprout = a !== i;
      const q = point(this.u[a]);
      const ox = q.nx * this.off[a] * Rc * wrap, oy = q.ny * this.off[a] * Rc * wrap;
      const x = q.x + ox + (sprout ? (q.tx * this.dtn[i] + q.nx * this.dnn[i]) * Rc : 0);
      const y = q.y + oy + (sprout ? (q.ty * this.dtn[i] + q.ny * this.dnn[i]) * Rc : 0);
      sk.add(x, y, this.parent[i], q.flex, src.w[i] * scaleW, src.kind[i]);
      const thin = hash1(snap.ids[i] * 3.7) > keep ? 0 : 1;
      this.nodeAlpha[i] = snap.alpha[i] * thin * (sprout ? sproutFade : runnerFade) * fade;
    }
    sk.computeChildren();
    if (after < 0.3) hooks.strand(sk, snap.vis, this.nodeAlpha, snap.ids, tg.layer, look, snap, pl.scale);

    // Core line, until the plant's own spine takes over at the impact.
    if (after < 0) {
      const N = 72;
      const ringW = this.p.halo.ringWidth * scaleW;
      let a = point(0);
      const wOf = (s: { w: number }) => lerp(ringW, s.w, sigma);
      for (let j = 1; j <= N; j++) {
        const b = point(j / N);
        hooks.stroke(tg.layer, a.x, a.y, b.x, b.y, wOf(a), wOf(b), a.flex, b.flex, look);
        a = b;
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
      snap.theme === 'thorns' ? 1 : snap.theme === 'wreath' ? (h < 0.2 ? 2 : 3) : snap.theme === 'branches' ? -1 : 0;
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
