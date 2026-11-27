// Planting a take (docs/fable-consult.md, Part B; reworked): when a live take finishes recording,
// its halo becomes that take's tree, in three calm steps:
//   1 curl     the ring is cut just ahead of its growing tip into one piece per primary limb
//              (commit.limbs); each piece rolls up in place from its newer end, like a fern frond,
//              into a small coil
//   2 move     the coils glide round the head to where their limbs start (where each limb comes
//              out from behind the singer), turning to line up with the limb
//   3 unroll   each coil unrolls along its limb, arc length conserved: a stalk lies down on the
//              limb while a shrinking coil rides at its end
//   hand-over  the take's tree takes over, fully grown: the limbs the fronds lie on are there at
//              once, the rest grows out from them; the frond's vine and leaves fade into it. From
//              then on it is a tree whose phrase has just ended, so it rests and ends the way
//              growth.onPhraseEnd says.
//
// The strand is drawn in the take's own layer with the take tree's colours and theme (main.ts
// blends from the halo's colour while it curls and moves), so nothing changes colour at the
// hand-over.
//
// The hand-over time is decided in step(), called from the simulation; every pose is a pure
// function of time, the snapshot and the current placement, drawn by draw().

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
  /** The halo's look at the commit (main.ts Look); the strand eases from it to the tree's. */
  look?: { intensity: number; glow: number; shine: number; width: number; bloom: number };
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
  delay: number;
}

/** How far along the planting is, for the colours and look (main.ts). */
export interface StrandState {
  /** 0 = the halo's colours, 1 = the tree's (reached when the coils arrive). */
  colour: number;
  /** 0 = the halo's look at the commit, 1 = the tree's own (reached at the hand-over). */
  look: number;
  /** Overall opacity (fades after the hand-over, or when the take vanished). */
  alpha: number;
}

/** Drawing callback provided by main.ts (it reuses pushTree / decorateTree). */
export interface CommitHooks {
  /** The strand skeleton (plant-local coordinates) in the plant's layer. `lineAlpha` draws the
   *  strokes, `decoAlpha` the leaves (the ring line nodes carry none). */
  strand(sk: Skeleton, vis: Float32Array, lineAlpha: Float32Array, decoAlpha: Float32Array, ids: Int32Array, layer: number,
         snap: HaloSnapshot, unit: number, state: StrandState): void;
}

interface Pose {
  x: number;
  y: number;
  tx: number;
  ty: number;
  /** Outward normal (the ring's outside; on a coil, away from its centre). */
  nx: number;
  ny: number;
  /** Where on the tree this point lands (for the colours along the branch). */
  flex: number;
  /** Line width (plant units): the ring line's, then the limb's as it lies down on it. */
  w: number;
  /** Scale of the vine's offsets from the ring line (plant units per ring radius). */
  S: number;
}

// Step lengths in seconds at commit.duration 1.
// It curls up and, from moveAt on, glides to the limb's start while it is still curling.
const T = { curl: 1.2, moveAt: 0.25, move: 1.45, unroll: 1.5, settle: 0.6 };
const STAGGER = 0.12;
/** Turns of a fully curled frond. Its curvature grows fourfold toward the tip, so it is a
 *  tightening spiral (a fern's fiddlehead), not a loop. */
const TURNS = 1.75;
const SAMPLES = 48;

/** A unit-length spiral turning by `theta` in all: x, y (tangent at the start = +x, curling
 *  toward +y) and the direction, at SAMPLES + 1 evenly spaced points. */
function spiral(theta: number) {
  const X = new Float32Array(SAMPLES + 1), Y = new Float32Array(SAMPLES + 1), A = new Float32Array(SAMPLES + 1);
  const k0 = theta / 2.5; // curvature k0 * (1 + 3 u): integrates to theta
  const ds = 1 / SAMPLES;
  for (let j = 1; j <= SAMPLES; j++) {
    const um = (j - 0.5) * ds, a = k0 * (um + 1.5 * um * um);
    X[j] = X[j - 1] + Math.cos(a) * ds;
    Y[j] = Y[j - 1] + Math.sin(a) * ds;
    const u = j * ds;
    A[j] = k0 * (u + 1.5 * u * u);
  }
  // Its middle (for moving it about): the mean of the points.
  let cx = 0, cy = 0;
  for (let j = 0; j <= SAMPLES; j++) {
    cx += X[j];
    cy += Y[j];
  }
  return { X, Y, A, cx: cx / (SAMPLES + 1), cy: cy / (SAMPLES + 1) };
}
type Spiral = ReturnType<typeof spiral>;

const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const smoothstep = (x: number) => x * x * (3 - 2 * x);
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class CommitAnimation {
  /** Sim time of the hand-over (the tree takes over), -1 before. */
  stampedAt = -1;
  /** Sim time the destination vanished before the hand-over (the strand fades). */
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
  private vis = new Float32Array(0);
  private lineAlpha = new Float32Array(0);
  private decoAlpha = new Float32Array(0);
  private ids = new Int32Array(0);
  private last?: CommitTarget;
  /** Start time; held back until the destination tree is built. */
  private t0: number;
  /** The fronds, frozen for the plant they were made for. */
  private pcs: Piece[] | null = null;
  private pcsPlant: Plant | null = null;
  private pieceOf = new Uint8Array(0);
  private pparent = new Int32Array(0);

  constructor(readonly slotId: string, readonly snap: HaloSnapshot, t0: number, private p: Params) {
    this.t0 = t0;
    this.dir = snap.lead.sign >= 0 ? 1 : -1;
    this.thetaCut = snap.lead.angle + this.dir * 0.06; // just ahead of the leading tip
    const sk = snap.sk, n = sk.n;
    this.u = new Float32Array(n);
    this.off = new Float32Array(n);
    this.anchor = new Int32Array(n);
    this.dtn = new Float32Array(n);
    this.dnn = new Float32Array(n);
    this.parent = Int32Array.from(sk.parent.subarray(0, n));
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

  /** Seconds (at duration 1) from the start to the hand-over, for K fronds. */
  private handOver(K: number) {
    return T.moveAt + T.move + T.unroll + STAGGER * (K - 1);
  }

  /** Simulation step. Returns true on the frame of the hand-over. */
  step(t: number, target: CommitTarget | undefined): boolean {
    if (target) this.last = target;
    else if (this.stampedAt < 0 && this.abortedAt < 0) this.abortedAt = t;
    if (this.abortedAt >= 0) {
      this.done = t - this.abortedAt > 0.45;
      return false;
    }
    // Wait (as the ring) until the tree it becomes is built: the fronds depend on its limbs.
    if (target && !target.plant.built && t > this.t0) this.t0 = t;
    const k = this.k;
    if (this.stampedAt < 0 && target && target.plant.built && (t - this.t0) / k >= this.handOver(this.pieces(target).length)) {
      this.stampedAt = t;
      return true;
    }
    if (this.stampedAt >= 0) this.done = t - this.stampedAt > T.settle * k;
    return false;
  }

  /** Seconds since the hand-over (-1 before). */
  sinceImpact(t: number) {
    return this.stampedAt < 0 ? -1 : t - this.stampedAt;
  }

  /** Show the limbs the fronds landed on (called at the hand-over). */
  revealLimbs(plant: Plant) {
    for (const pc of this.pcs ?? []) plant.revealLimb(pc.k, pc.d0 + pc.L);
  }

  // ---- Fronds ------------------------------------------------------------------------------------

  private pieces(tg: CommitTarget): Piece[] {
    const plant = tg.plant;
    if (this.pcs && this.pcsPlant === plant) return this.pcs;
    const P = plant.limbPaths;
    const sc = Math.max(0.05, tg.place.scale);
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
      // From the origin point: where the limb leaves the hub (or the top of the trunk).
      const d0 = P[k]?.base ?? 0;
      const L = Math.max(0.25, this.fit(tg, k, d0));
      return { k, d0, L, delay: STAGGER * m };
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
    // Cached once the tree is built (before that its limbs are not known).
    if (plant.built) {
      this.pcs = pcs;
      this.pcsPlant = plant;
    }
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

  // ---- Drawing -----------------------------------------------------------------------------------

  draw(t: number, target: CommitTarget | undefined, hooks: CommitHooks) {
    const tg = target ?? this.last;
    if (!tg) return;
    const k = this.k;
    if (this.abortedAt >= 0 && this.stampedAt < 0) {
      // Destination gone before the hand-over: the strand fades where it is.
      this.drawStrand(Math.max(0, (this.abortedAt - this.t0) / k), tg, hooks, 1 - clamp((t - this.abortedAt) / 0.4));
      return;
    }
    const after = this.sinceImpact(t);
    const fade = after < 0 ? 1 : 1 - smoothstep(clamp(after / (T.settle * k)));
    if (fade > 0.003) this.drawStrand(Math.max(0, (t - this.t0) / k), tg, hooks, fade);
  }

  private drawStrand(tau: number, tg: CommitTarget, hooks: CommitHooks, fade: number) {
    const pl = tg.place, plant = tg.plant, snap = this.snap;
    const built = plant.built;
    const pcs = this.pieces(tg), K = pcs.length;
    const sc = Math.max(0.05, pl.scale);
    // Progress of each step (held at the start until the tree is built).
    const curl = built ? easeInOutCubic(clamp(tau / T.curl)) : 0;
    const move = built ? easeInOutCubic(clamp((tau - T.moveAt) / T.move)) : 0;
    const tUn = T.moveAt + T.move;
    const sig = pcs.map((pc) => (built ? smoothstep(clamp((tau - tUn - pc.delay) / T.unroll)) : 0));

    // The ring in plant-local coordinates (it keeps the halo's squish and tilt while it curls).
    const kIdle = (snap.idle ?? 1) * (1 - curl);
    const sq = 1 - clamp(this.p.halo.squish, 0, 0.95) * kIdle;
    const ringPl = { ox: snap.cx, oy: snap.cy, angle: Math.PI / 2 + this.p.halo.tilt * deg * kIdle, scale: snap.R } as Placement;
    const plantPl = { ...pl, angle: pl.angle + tg.spinAngle };
    const ringLocal = (lx: number, ly: number) => {
      const [wx, wy] = toWorld(lx, ly * sq, ringPl);
      return toLocal(wx, wy, plantPl);
    };
    const ringW = this.p.halo.ringWidth / sc;
    const Sring = snap.R / sc; // a ring radius in plant units
    const side = this.dir; // the coils curl toward the ring's inside, and keep that hand on the limb
    const perp = (tx: number, ty: number) => ({ x: -ty * side, y: tx * side });

    /** Point v (0..1) of the ring arc of piece m, with its direction of travel. */
    const ringAt = (m: number, v: number) => {
      const th = this.thetaCut + this.dir * ((m + v) / K) * TAU, e = 0.002 * this.dir;
      const [x, y] = ringLocal(Math.cos(th), Math.sin(th));
      const [x2, y2] = ringLocal(Math.cos(th + e), Math.sin(th + e));
      const l = Math.hypot(x2 - x, y2 - y) || 1;
      return { x, y, tx: (x2 - x) / l, ty: (y2 - y) / l };
    };
    /** The spiral `sp`, `len` long, leaving (x, y) along (tx, ty): its point at fraction s (0..1). */
    const coil = (x: number, y: number, tx: number, ty: number, len: number, sp: Spiral, s: number) => {
      const f = clamp(s) * SAMPLES, j = Math.min(SAMPLES - 1, Math.floor(f)), w = f - j;
      const lx = lerp(sp.X[j], sp.X[j + 1], w) * len, ly = lerp(sp.Y[j], sp.Y[j + 1], w) * len * side;
      const a = lerp(sp.A[j], sp.A[j + 1], w) * side, co = Math.cos(a), si = Math.sin(a);
      const ux = tx * co - ty * si, uy = tx * si + ty * co, n = perp(ux, uy);
      return { x: x + tx * lx - ty * ly, y: y + ty * lx + tx * ly, tx: ux, ty: uy, nx: -n.x, ny: -n.y };
    };
    /** Offsets from the line, scaled for a coil `len` long (about its radius). */
    const coilS = (len: number) => len / (TAU * TURNS) * 1.6;
    const full = spiral(TURNS * TAU);
    // Each piece: its length on the ring (plant units), its curled spiral, and where its limb starts.
    const frames = pcs.map((pc, m) => {
      const a = ringAt(m, 0), b = plant.limbAt(pc.k, pc.d0);
      return { a, lA: (TAU * Sring) / K, b };
    });
    const headX = this.p.avatar.headX, headY = this.p.avatar.headY;
    const spirals = pcs.map((_, m) => (sig[m] > 0 ? spiral(TURNS * TAU * Math.sqrt(1 - sig[m])) : curl < 1 ? spiral(TURNS * TAU * Math.sqrt(curl)) : full));

    const pose = (m: number, v: number): Pose => {
      const pc = pcs[m], fr = frames[m], flex = pc.d0 + pc.L * v;
      if (sig[m] <= 0) {
        // 1 + 2: it rolls up from its newer end (the rest still lies on the ring) and, at the same
        // time, the whole piece glides to the limb's start: its start point goes round the head from
        // the ring to there, turning to line up with the limb and growing to the frond's length.
        const s0 = 1 - curl;
        let S = lerp(Sring, coilS(fr.lA), curl);
        let q: { x: number; y: number; tx: number; ty: number; nx: number; ny: number };
        if (v <= s0 || curl <= 0) {
          const a = ringAt(m, v), n = perp(a.tx, a.ty);
          q = { x: a.x, y: a.y, tx: a.tx, ty: a.ty, nx: -n.x, ny: -n.y };
        } else {
          const a = ringAt(m, s0);
          q = coil(a.x, a.y, a.tx, a.ty, fr.lA * curl, spirals[m], (v - s0) / curl);
        }
        if (move > 0) {
          const A = fr.a, B = fr.b, k = lerp(1, pc.L / fr.lA, move);
          const al = wrapPi(Math.atan2(B.ty, B.tx) - Math.atan2(A.ty, A.tx)) * move, c = Math.cos(al), si = Math.sin(al);
          // The start's path: polar about the head, so it goes round it rather than across the face.
          const [ax, ay] = toWorld(A.x, A.y, plantPl), [bx, by] = toWorld(B.x, B.y, plantPl);
          const thA = Math.atan2(ay - headY, ax - headX), thB = Math.atan2(by - headY, bx - headX);
          const th = thA + wrapPi(thB - thA) * move;
          const rr = lerp(Math.hypot(ax - headX, ay - headY), Math.hypot(bx - headX, by - headY), move);
          const [px, py] = toLocal(headX + Math.cos(th) * rr, headY + Math.sin(th) * rr, plantPl);
          const rx = (q.x - A.x) * k, ry = (q.y - A.y) * k;
          q = {
            x: px + c * rx - si * ry, y: py + si * rx + c * ry,
            tx: c * q.tx - si * q.ty, ty: si * q.tx + c * q.ty, nx: c * q.nx - si * q.ny, ny: si * q.nx + c * q.ny,
          };
          S *= k;
        }
        return { ...q, flex, w: lerp(ringW, fr.b.w, 0.3 * move), S };
      }
      // 3 unroll along the limb from where it leaves the avatar.
      const sigma = sig[m], S = coilS(pc.L) * lerp(1, 0.6, sigma);
      if (v <= sigma || sigma >= 0.999) {
        const sp = plant.limbAt(pc.k, pc.d0 + pc.L * v), n = perp(sp.tx, sp.ty);
        return { x: sp.x, y: sp.y, tx: sp.tx, ty: sp.ty, nx: -n.x, ny: -n.y, flex, w: lerp(ringW, sp.w, 0.3 + 0.7 * sigma), S };
      }
      const sp = plant.limbAt(pc.k, pc.d0 + pc.L * sigma);
      const c = coil(sp.x, sp.y, sp.tx, sp.ty, pc.L * (1 - sigma), spirals[m], (v - sigma) / (1 - sigma));
      return { ...c, flex, w: lerp(ringW, sp.w, 0.3 + 0.7 * sigma), S };
    };

    // The halo's vine, riding on the ring line / frond.
    const src = snap.sk, sk = this.tmp;
    sk.reset();
    const N = Math.max(12, Math.round(96 / K)); // ring line points per piece
    const total = src.n + K * (N + 1);
    if (this.vis.length < total) {
      this.vis = new Float32Array(total * 2);
      this.lineAlpha = new Float32Array(total * 2);
      this.decoAlpha = new Float32Array(total * 2);
      this.ids = new Int32Array(total * 2);
    }
    const unrolled = sig.reduce((a, b) => a + b, 0) / K;
    for (let i = 0; i < src.n; i++) {
      const a = this.anchor[i], sprout = a !== i, m = this.pieceOf[i];
      const q = pose(m, clamp(this.u[a] * K - m));
      const o = this.off[a] * q.S;
      const x = q.x + q.nx * o + (sprout ? (q.tx * this.dtn[i] + q.nx * this.dnn[i]) * q.S : 0);
      const y = q.y + q.ny * o + (sprout ? (q.ty * this.dtn[i] + q.ny * this.dnn[i]) * q.S : 0);
      sk.add(x, y, this.pparent[i], q.flex, src.w[i] / sc, src.kind[i]);
      this.vis[i] = snap.vis[i];
      this.ids[i] = snap.ids[i];
      // Half the vine's shoots let go while it curls (a coil cannot hold them all), and a little
      // more of it while it unrolls, so the frond is not a tangle on the limb.
      const h = hash1(snap.ids[i] * 3.7);
      const thin = h > 0.5 ? 1 - curl : h > lerp(0.5, 0.4, unrolled) ? 1 - 0.6 * smoothstep(unrolled) : 1;
      this.lineAlpha[i] = this.decoAlpha[i] = snap.alpha[i] * thin * fade;
    }
    // The ring line of each piece: it becomes the frond's core, then lies down on the limb.
    for (let m = 0; m < K; m++) {
      let prev = -1;
      for (let j = 0; j <= N; j++) {
        const q = pose(m, j / N), i = sk.n;
        prev = sk.add(q.x, q.y, prev, q.flex, q.w, NodeKind.Runner);
        this.vis[i] = 1;
        this.ids[i] = -1 - i;
        this.lineAlpha[i] = fade;
        this.decoAlpha[i] = 0;
      }
    }
    sk.computeChildren();
    hooks.strand(sk, this.vis, this.lineAlpha, this.decoAlpha, this.ids, tg.layer, snap, sc, {
      colour: built ? smoothstep(clamp(tau / tUn)) : 0,
      look: built ? smoothstep(clamp(tau / this.handOver(K))) : 0,
      alpha: fade,
    });
  }
}
