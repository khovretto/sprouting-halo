// Live take: an endless vine looping round the halo ring (unit-circle space, radius 1).
//
// Growing tips start at `halo.origins` points spread evenly round the ring (from halo.startAngle;
// with bothWays, two tips per origin going opposite ways). They never stop: they creep round at
// halo.idleSpeed and race at up to halo.singSpeed while singing. Each tip trails halo.tailDeg of
// vine behind it; the oldest part fades out and is dropped, so the vine renews itself forever.
//
// Singing shapes what grows:
//  - loudness: speed, and how often side shoots sprout (note starts always sprout one)
//  - effort: longer, thicker shoots (full voice) or short ones (soft)
//  - softness: curlier tendrils
//  - pitch: high notes send shoots outward, low notes inward
//
// The skeleton is rebuilt from the live nodes every frame. Node ids are stable, so decorations
// hashed on them don't flicker.

import type { Drive } from '../drive';
import type { Params } from '../params';
import { angleLerp, clamp, deg, noise1, rng, Rng, TAU } from '../math';
import { bendFrames, NodeKind, Skeleton } from './skeleton';

interface VNode {
  id: number;
  x: number;
  y: number;
  parent: VNode | null;
  flex: number;
  w: number;
  kind: NodeKind;
  runner: number;
  /** Runner arc (radians travelled) where this node sits; shoots use their anchor's. */
  arcAt: number;
  /** Shoots: time the shoot started growing and position along it (0..1). */
  growStart: number;
  pos: number;
}

interface Tip {
  node: VNode;
  heading: number;
  sign: number;
  arc: number;
  budget: number;
}

const STEP = 0.014;

export class HaloVine {
  sk = new Skeleton(4096);
  vis = new Float32Array(0);
  alpha = new Float32Array(0);
  ids = new Int32Array(0);
  /** Per node: 1 runner, 2 sprout (motion), and the bend frames for the sprouts' own bend. */
  order = new Uint8Array(0);
  bend = new Float32Array(0);
  private nodes: VNode[] = [];
  private tips: Tip[] = [];
  private nextId = 1;
  private r: Rng;
  private t = 0;
  private sproutDue = 0;
  private signature = '';

  constructor(readonly seed: number, p: Params) {
    this.r = rng(seed);
    this.reset(p);
  }

  private reset(p: Params) {
    const h = p.halo;
    this.signature = [h.origins, h.startAngle, h.bothWays].join('|');
    this.nodes = [];
    this.tips = [];
    const n = Math.max(1, Math.round(h.origins));
    for (let k = 0; k < n; k++) {
      const a = h.startAngle * deg + (k * TAU) / n;
      const signs = h.bothWays ? [1, -1] : [1];
      for (const sign of signs) {
        const node = this.add(Math.cos(a), Math.sin(a), null, 0, h.vineWidth, NodeKind.Runner, this.tips.length, 0, 0, 1);
        this.tips.push({ node, heading: a + (sign * Math.PI) / 2, sign, arc: 0, budget: 0 });
      }
    }
  }

  /** The growing tip that has travelled furthest: its ring angle and direction (+1 ccw, -1 cw). */
  leadTip() {
    let best = this.tips[0];
    for (const tip of this.tips) if (tip.arc > best.arc) best = tip;
    return best ? { angle: Math.atan2(best.node.y, best.node.x), sign: best.sign } : { angle: 0, sign: 1 };
  }

  /** Restart from the origins if their layout changed. */
  ensureLayout(p: Params) {
    const h = p.halo;
    if ([h.origins, h.startAngle, h.bothWays].join('|') !== this.signature) this.reset(p);
  }

  private add(x: number, y: number, parent: VNode | null, flex: number, w: number, kind: NodeKind,
              runner: number, arcAt: number, growStart: number, pos: number) {
    const n: VNode = { id: this.nextId++, x, y, parent, flex, w, kind, runner, arcAt, growStart, pos };
    this.nodes.push(n);
    return n;
  }

  update(dt: number, d: Drive, onset: boolean, p: Params) {
    const h = p.halo;
    this.t += dt;
    this.ensureLayout(p);

    // Tips creep round, faster while singing.
    const speed = (h.idleSpeed + h.singSpeed * clamp(d.energy * 1.2)) * deg; // radians per second
    for (let ti = 0; ti < this.tips.length; ti++) {
      const tip = this.tips[ti];
      tip.budget += speed * dt;
      let guard = 0;
      while (tip.budget >= STEP && guard++ < 64) {
        tip.budget -= STEP;
        this.stepTip(ti, tip, h);
      }
    }

    // Side shoots: steady with loudness, plus one on every note start.
    this.sproutDue += h.sproutRate * clamp(d.energy * 1.3) * dt;
    let count = Math.floor(this.sproutDue) + (onset ? 1 : 0);
    this.sproutDue -= Math.floor(this.sproutDue);
    while (count-- > 0 && this.tips.length) this.sprout(this.tips[Math.floor(this.r() * this.tips.length)], d, h);

    // Drop vine that has fallen off the end of every tail.
    const tail = Math.max(0.1, h.tailDeg * deg);
    this.nodes = this.nodes.filter((n) => this.tips[n.runner] && this.tips[n.runner].arc - n.arcAt <= tail);
    this.rebuild(p);
  }

  private stepTip(ti: number, tip: Tip, h: Params['halo']) {
    const px = tip.node.x, py = tip.node.y;
    const rho = Math.hypot(px, py), th = Math.atan2(py, px);
    const target = 1 + h.wander * noise1(tip.arc * 2.2, this.seed + ti * 13);
    const corr = clamp((target - rho) * 14, -1, 1) * 0.9;
    tip.heading = angleLerp(tip.heading, th + (tip.sign * Math.PI) / 2 - tip.sign * corr, 0.25) + (this.r() - 0.5) * 0.15;
    tip.arc += STEP;
    tip.node = this.add(px + Math.cos(tip.heading) * STEP, py + Math.sin(tip.heading) * STEP, tip.node, 0,
      h.vineWidth, NodeKind.Runner, ti, tip.arc, 0, 1);
  }

  private sprout(tip: Tip, d: Drive, h: Params['halo']) {
    const anchor = tip.node;
    const th = Math.atan2(anchor.y, anchor.x);
    // High notes grow outward, low notes inward.
    const outward = this.r() < 0.35 + 0.5 * d.pitch;
    let heading = th + (outward ? 0 : Math.PI) + (this.r() < 0.5 ? 1 : -1) * (0.3 + this.r() * 0.7);
    // Soft singing: curly tendrils. Full voice: longer, straighter, thicker shoots.
    let curl = (this.r() < 0.5 ? -1 : 1) * h.sproutCurl * (0.02 + this.r() * 0.05) * (0.5 + 1.5 * d.softness);
    const len = Math.max(3, Math.round(h.sproutLength * (0.4 + d.effort) * (0.6 + this.r() * 0.7)));
    const width = h.sproutWidth * (0.7 + 0.6 * d.effort);
    let node = anchor, flex = 0;
    for (let k = 1; k <= len; k++) {
      heading += curl;
      curl *= 1.07;
      flex += STEP;
      node = this.add(node.x + Math.cos(heading) * STEP, node.y + Math.sin(heading) * STEP, node, flex,
        width * (0.3 + (0.7 * (len - k)) / len), NodeKind.Sprout, anchor.runner, anchor.arcAt, this.t, k / len);
    }
  }

  /** Rebuild the skeleton and per-node growth / fade from the live nodes. */
  private rebuild(p: Params) {
    const h = p.halo;
    const sk = this.sk;
    sk.reset();
    const n = this.nodes.length;
    if (this.vis.length < n) {
      this.vis = new Float32Array(n * 2);
      this.alpha = new Float32Array(n * 2);
      this.ids = new Int32Array(n * 2);
    }
    const index = new Map<number, number>();
    const tail = Math.max(0.1, h.tailDeg * deg);
    const fadeStart = tail * (1 - clamp(h.tailFade, 0.01, 1));
    const grow = Math.max(0.05, h.sproutGrow);
    for (let i = 0; i < n; i++) {
      const v = this.nodes[i];
      const pi = v.parent ? index.get(v.parent.id) ?? -1 : -1;
      const j = sk.add(v.x, v.y, pi, v.flex, v.w, v.kind);
      index.set(v.id, j);
      this.ids[j] = v.id;
      this.vis[j] = v.kind === NodeKind.Sprout ? clamp((((this.t - v.growStart) / grow) * 1.15 - v.pos) / 0.15) : 1;
      const behind = this.tips[v.runner].arc - v.arcAt;
      const f = clamp((behind - fadeStart) / Math.max(1e-3, tail - fadeStart));
      this.alpha[j] = 1 - f * f * (3 - 2 * f);
    }
    sk.computeChildren();
    if (this.order.length < sk.n) this.order = new Uint8Array(sk.n * 2);
    for (let i = 0; i < sk.n; i++) this.order[i] = sk.kind[i] === NodeKind.Sprout ? 2 : 1;
    this.bend = bendFrames(sk, this.order, this.bend);
  }

  /**
   * 0..1 how strongly the live vine covers a ring angle (for the ring's leaves): 1 near a tip's
   * fresh vine, fading along the tail.
   */
  coverage(angle: number, p: Params) {
    const tail = Math.max(0.1, p.halo.tailDeg * deg);
    const fadeStart = tail * (1 - clamp(p.halo.tailFade, 0.01, 1));
    let best = 0;
    for (const tip of this.tips) {
      const tipAngle = Math.atan2(tip.node.y, tip.node.x);
      // Distance behind the tip along its direction of travel.
      let behind = ((tip.sign * (tipAngle - angle)) % TAU + TAU) % TAU;
      // Only up to the vine actually grown so far.
      if (behind > Math.min(tail, tip.arc)) continue;
      const f = clamp((behind - fadeStart) / Math.max(1e-3, tail - fadeStart));
      best = Math.max(best, 1 - f * f * (3 - 2 * f));
      if (best >= 1) break;
    }
    return best;
  }
}
