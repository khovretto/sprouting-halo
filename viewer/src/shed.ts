// Falling decorations (docs/fable-consult-6-presets-growth.md, 4): with growth.shed, a leaf or
// blossom that would shrink back (its twig withers, its bloom closes) lets go at full size and
// falls. One pool per plant, in the plant's local frame, so they fade and die with it.

import type { Instances } from './render/renderer';
import { lerp, RGB } from './math';

const MAX = 512; // room for showers (look.leafFall)
const N = 20; // floats per particle

/** What the pool needs from the decoration style of the frame it is drawn in. */
export interface ShedStyle {
  alpha: number;
  glow: number;
  layer: number;
  /** World down in the layer's frame (per world unit). */
  downX: number;
  downY: number;
}

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

export class ShedPool {
  private d = new Float32Array(MAX * N);
  private head = 0;
  count = 0;

  /** frame: order, pivot x, y, flex, heading of the node it hung on (null = rigid at the point). */
  add(now: number, x: number, y: number, angle: number, size: number, shape: number, c: ArrayLike<number>,
      flex: number, h: number, glowMul: number, frame: ArrayLike<number> | null, alpha: number, pivY = 0, pivX = 0) {
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
    this.head = (this.head + 1) % MAX;
    this.count = Math.min(MAX, this.count + 1);
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
      const life = 1.1 + 0.6 * h;
      if (age < 0 || age >= life) continue;
      alive++;
      const blossom = d[o + 5] === 5;
      const vT = blossom ? 0.35 : 0.55, kk = 3; // terminal speed (world units / s), how fast it is reached
      const fallD = vT * (age - (1 - Math.exp(-kk * age)) / kk); // closed form: any frame rate places it alike
      const sway = 0.05 * Math.sin(age * (5 + 3 * h) + h * 6.28) * Math.min(1, age * 2);
      const x = d[o + 1] + st.downX * fallD - st.downY * sway;
      const y = d[o + 2] + st.downY * fallD + st.downX * sway;
      const ang = d[o + 3] + (h - 0.5) * 6 * age + 0.6 * Math.sin(age * 4 + h * 9);
      const u = age / life;
      const a = d[o + 12] * st.alpha * (u < 0.5 ? 1 : 1 - smooth((u - 0.5) * 2));
      if (a <= 0.01) continue;
      const m = 0.4 * Math.min(1, age / 0.8);
      const px = d[o + 14] + (x - d[o + 1]), py = d[o + 15] + (y - d[o + 2]); // the pivot travels with it
      out.sprite(x, y, ang, d[o + 4], d[o + 5], d[o + 9], h,
        lerp(d[o + 6], dry[0], m), lerp(d[o + 7], dry[1], m), lerp(d[o + 8], dry[2], m),
        a, st.glow * d[o + 11], st.layer, d[o + 13], px, py, d[o + 16], d[o + 17], d[o + 18], d[o + 19]);
    }
    if (!alive) this.count = this.head = 0;
  }
}
