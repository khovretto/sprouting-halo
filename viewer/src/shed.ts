// Falling decorations (docs/fable-consult-6-presets-growth.md, 4): with growth.shed, a leaf or
// blossom that would shrink back (its twig withers, its bloom closes) lets go at full size and
// falls. One pool per plant, in the plant's local frame, so they fade and die with it.

import type { Instances } from './render/renderer';
import { carried, clamp, fallDir, flightDist, flightSpeed, lerp, RGB } from './math';

const MAX = 512; // room for showers (look.leafFall)
const N = 38; // floats per particle

/** What the pool needs from the decoration style of the frame it is drawn in. */
export interface ShedStyle {
  alpha: number;
  glow: number;
  layer: number;
  /** World down in the layer's frame (per world unit). */
  downX: number;
  downY: number;
  /** How they fall (params.falling): speed, side-to-side sway, turning, wind flutter, time; and the
   *  straight drop before they sway (seconds, how much leaves differ, how much faster). */
  drop?: { speed: number; sway: number; spin: number; flutter: number; time: number; dropSeconds?: number; dropVariety?: number; dropSpeed?: number;
    /** How differently each leaf falls (falling.variety). */
    variety?: number };
  /** growth.fallDirection "away": they drift straight out from (originX, originY), no gravity. */
  fallAway?: boolean;
  /** growth.fallDirection "up": they float up. */
  fallUp?: boolean;
  originX?: number;
  originY?: number;
}

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const fract = (x: number) => x - Math.floor(x);

/** The drop: `a` (seconds) until te, then nothing more, eased over w either side; and its slope. */
function dropPart(a: number, te: number): [number, number] {
  if (te <= 0) return [0, 0];
  const w = Math.min(0.15, te);
  if (a <= te - w) return [a, 1];
  if (a >= te + w) return [te, 0];
  const x = a - te + w;
  return [a - (x * x) / (4 * w), 1 - x / (2 * w)];
}

export class ShedPool {
  private d = new Float32Array(MAX * N);
  private head = 0;
  count = 0;
  private lastAdd = -Infinity;

  /** Something may still be falling at `now` (falling.time: their life scale); needs no draw. */
  busy(now: number, time: number) {
    return this.count > 0 && now - this.lastAdd < 1.7 * Math.max(0.1, time);
  }

  /** frame: order, pivot x, y, flex, heading of the node it hung on (null = rigid at the point).
   *  look: the glow and the falling settings it keeps while it falls (a look change, or a slider
   *  moved meanwhile, does not change a leaf already falling). */
  add(now: number, x: number, y: number, angle: number, size: number, shape: number, c: ArrayLike<number>,
      flex: number, h: number, glowMul: number, frame: ArrayLike<number> | null, alpha: number, pivY = 0, pivX = 0,
      look?: { glow: number; drop?: ShedStyle['drop'] }) {
    const d = this.d;
    let o = this.head * N;
    d[o++] = now; d[o++] = x; d[o++] = y; d[o++] = angle;
    d[o++] = size; d[o++] = shape; d[o++] = c[0]; d[o++] = c[1];
    d[o++] = c[2]; d[o++] = flex; d[o++] = h; d[o++] = glowMul;
    d[o++] = alpha;
    if (frame) {
      d[o++] = frame[0]; d[o++] = frame[1]; d[o++] = frame[2]; d[o++] = frame[3]; d[o++] = frame[4];
    } else {
      d[o++] = 1; d[o++] = x; d[o++] = y; d[o++] = flex; d[o++] = 0;
    }
    d[o++] = pivY; d[o++] = pivX;
    const dp = look?.drop;
    d[o++] = dp ? dp.speed : NaN; d[o++] = dp ? dp.sway : 1; d[o++] = dp ? dp.spin : 1; d[o++] = dp ? dp.flutter : 1;
    d[o++] = dp ? dp.time : 1; d[o++] = look ? look.glow : NaN;
    d[o++] = dp ? dp.dropSeconds ?? 0 : NaN; d[o++] = dp ? dp.dropVariety ?? 0 : 0; d[o++] = dp ? dp.dropSpeed ?? 1 : 1;
    // Its flight so far (set when first drawn; again when growth.fallDirection changes in flight):
    // which way (-1 not yet), from what age, where it was, the speed it carried, the way it went.
    d[o++] = -1; d[o++] = 0; d[o++] = x; d[o++] = y; d[o++] = 0; d[o++] = 0; d[o++] = NaN; d[o++] = NaN;
    d[o++] = dp ? dp.variety ?? 0 : NaN;
    this.head = (this.head + 1) % MAX;
    this.count = Math.min(MAX, this.count + 1);
    this.lastAdd = now;
  }

  clear() {
    this.count = 0;
    this.head = 0;
  }

  /** Draw every living particle; dry: the colour they turn toward as they fall. */
  draw(out: Instances, st: ShedStyle, now: number, dry: RGB) {
    const d = this.d;
    let alive = 0;
    for (let k = 0; k < this.count; k++) {
      const o = k * N;
      const age = now - d[o];
      const h = d[o + 10];
      // Its own falling settings (NaN: none kept, those of the frame it is drawn in).
      const own = !Number.isNaN(d[o + 20]);
      const sd = st.drop;
      const dp = own ? { speed: d[o + 20], sway: d[o + 21], spin: d[o + 22], flutter: d[o + 23], time: d[o + 24], dropSeconds: d[o + 26], dropVariety: d[o + 27], dropSpeed: d[o + 28], variety: d[o + 37] }
        : { speed: sd?.speed ?? 1, sway: sd?.sway ?? 1, spin: sd?.spin ?? 1, flutter: sd?.flutter ?? 1, time: sd?.time ?? 1,
          dropSeconds: sd?.dropSeconds ?? 0, dropVariety: sd?.dropVariety ?? 0, dropSpeed: sd?.dropSpeed ?? 1, variety: sd?.variety ?? 0 };
      const glow = Number.isNaN(d[o + 25]) ? st.glow : d[o + 25];
      const life = (1.1 + 0.6 * h) * Math.max(0.1, dp.time);
      if (age < 0 || age >= life) continue;
      alive++;
      const blossom = d[o + 5] === 5, way = st.fallAway ? 1 : st.fallUp ? 2 : 0;
      // Its own way of falling (falling.variety; 0 = every leaf alike, as before). Most flutter:
      // each its own speed, swing width and rhythm, tilting into each swing and rising a little at
      // its ends like a pendulum. A few tumble: they spin end over end, fall faster, hardly swing
      // and slide off to one side.
      const vr = clamp(Number.isNaN(dp.variety) ? 0 : dp.variety);
      const r1 = fract(Math.sin(h * 12.9898 + 4.1) * 43758.5), r2 = fract(Math.sin(h * 78.233 + 1.7) * 24634.6);
      const r3 = fract(Math.sin(h * 37.719 + 2.3) * 17391.3), r4 = fract(Math.sin(h * 53.113 + 7.9) * 31415.9);
      const tumble = r1 < 0.33 * vr;
      const kSpeed = lerp(1, tumble ? 1.3 + 0.4 * r2 : 0.5 + 1.0 * r2, vr);
      const swayK = lerp(1, tumble ? 0.15 : 0.2 + 2.6 * r3 * r3 + 0.4 * r3, vr);
      const omega = lerp(5 + 3 * h, tumble ? 6 + 4 * r4 : 1.8 + 6.5 * r4, vr);
      const slide = vr * (0.3 + 0.7 * r4) * (tumble ? 0.28 : 0.09) * (r2 < 0.5 ? -1 : 1); // world units / s, across
      const spinRate = lerp((h - 0.5) * 6, tumble ? (r3 < 0.5 ? -1 : 1) * (7 + 7 * r2) : (h - 0.5) * 2.5, vr);
      const speed = dp.speed * kSpeed;
      // The straight drop (falling.dropSeconds): first it falls (dropSpeed times) faster without
      // swaying, then it slows and sways like a leaf. How long differs from leaf to leaf
      // (dropVariety: 0 all alike, 1 from at once to twice as long).
      const tDrop = Math.max(0, dp.dropSeconds) * lerp(1, 2 * fract(Math.sin(h * 91.7 + 3.1) * 43758.5), clamp(dp.dropVariety));
      const boost = Math.max(1, dp.dropSpeed) - 1;
      const warp = (a: number) => a + boost * dropPart(a, tDrop)[0];
      // Which way it falls changed in flight (a preset): it carries on from where it is, with the
      // speed it had, drag taking that away while it speeds up the new way.
      if (d[o + 29] !== way) {
        if (d[o + 29] >= 0) {
          const f = this.flight(o, age, d[o + 29], st, blossom, speed, warp, tDrop, boost);
          d[o + 31] = f[0]; d[o + 32] = f[1]; d[o + 33] = f[2]; d[o + 34] = f[3]; d[o + 35] = f[4]; d[o + 36] = f[5];
          d[o + 30] = age;
        }
        d[o + 29] = way;
      }
      const f = this.flight(o, age, way, st, blossom, speed, warp, tDrop, boost);
      // Side to side once the drop is over, across the way it falls (turning to the new way over
      // 0.6 s after a change), plus its slide; a flutterer rises a little at the ends of a swing.
      const sw = clamp((age - tDrop) * 2);
      const th = age * omega + h * 6.28, A = 0.05 * dp.sway * swayK * sw;
      const sway = A * Math.sin(th) + slide * Math.max(0, age - tDrop);
      const bob = tumble ? 0 : -0.45 * A * Math.sin(th) * Math.sin(th);
      let Px = -f[5], Py = f[4];
      if (!Number.isNaN(d[o + 35])) {
        const b = smooth((age - d[o + 30]) / 0.6);
        Px = lerp(-d[o + 36], Px, b);
        Py = lerp(d[o + 35], Py, b);
      }
      const x = f[0] + Px * sway + f[4] * bob;
      const y = f[1] + Py * sway + f[5] * bob;
      // Turning: a steady spin (fast for a tumbler) and, for a flutterer, a tilt into each swing.
      const tilt = tumble ? 0.6 * sw * (Math.sin(age * 4 + h * 9) - Math.sin(h * 9)) : lerp(0.6 * sw * (Math.sin(age * 4 + h * 9) - Math.sin(h * 9)), 0.7 * sw * Math.cos(th), vr);
      const ang = d[o + 3] + dp.spin * (spinRate * age + tilt);
      const u = age / life;
      const a = d[o + 12] * st.alpha * (u < 0.5 ? 1 : 1 - smooth((u - 0.5) * 2));
      if (a <= 0.01) continue;
      const m = 0.4 * Math.min(1, age / 0.8);
      // The motion frame stays the one it hung on: the shaders take each leaf's random wind and
      // flutter from its pivot point, so a moving pivot gave it new ones every frame (it stuttered).
      // Its twig's bend fades out over the first half second (flex toward the pivot's), so it does
      // not jump as it lets go.
      const px = d[o + 14], py = d[o + 15];
      const flex = lerp(d[o + 9], d[o + 16], smooth(age / 0.5));
      out.sprite(x, y, ang, d[o + 4], d[o + 5], flex, h,
        lerp(d[o + 6], dry[0], m), lerp(d[o + 7], dry[1], m), lerp(d[o + 8], dry[2], m),
        a, glow * d[o + 11], st.layer, d[o + 13], px, py, d[o + 16], d[o + 17], d[o + 18], d[o + 19], Math.max(0, dp.flutter));
    }
    if (!alive) this.count = this.head = 0;
  }

  /** Where particle o is at `age` in its current flight (no sway), its velocity, and the way it
   *  falls: [x, y, vx, vy, Dx, Dy]. */
  private flight(o: number, age: number, way: number, st: ShedStyle, blossom: boolean, speed: number,
                 warp: (a: number) => number, tDrop: number, boost: number) {
    const d = this.d;
    // terminal speed (world units / s), how fast it is reached
    // up: lighter than air, they rise more slowly than they would fall
    const vT = (way === 1 ? (blossom ? 0.25 : 0.35) : way === 2 ? (blossom ? 0.25 : 0.4) : blossom ? 0.35 : 0.55) * Math.max(0, speed), kk = way === 0 ? 3 : 2;
    const ts = d[o + 30], sx = d[o + 31], sy = d[o + 32], tau = age - ts;
    const [Dx, Dy] = fallDir(st.downX, st.downY, way, sx, sy, st.originX, st.originY);
    const w = warp(age) - warp(ts), along = flightDist(vT, kk, w), sp = flightSpeed(vT, kk, w) * (1 + boost * dropPart(age, tDrop)[1]);
    const c = carried(kk, tau), keep = Math.exp(-kk * Math.max(0, tau));
    return [sx + Dx * along + d[o + 33] * c, sy + Dy * along + d[o + 34] * c, Dx * sp + d[o + 33] * keep, Dy * sp + d[o + 34] * keep, Dx, Dy];
  }
}
