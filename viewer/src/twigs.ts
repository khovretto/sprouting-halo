// Falling twigs: branch pieces that broke off ("fall away": growth.onPause / onPhraseEnd / onStop).
// A piece is a run of segments of one branch; they fall together and fade, turning about the point
// where the piece broke off so that its loose end swings the way it falls (down, or with
// growth.fallDirection "away", straight out from where the tree grows), with a little tumble. One pool per plant, in
// the plant's local frame.

import type { Instances } from './render/renderer';
import { fallDir, lerp, RGB } from './math';

const MAX = 1536; // segments
const N = 24; // floats per segment

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

export class TwigPool {
  private d = new Float32Array(MAX * N);
  private head = 0;
  count = 0;

  /** One segment of a piece that let go at `t0`. pivot: where the piece broke off. h: the piece's
   *  random number 0..1. The rest is the stroke as it was drawn (render/renderer.ts); join: 1 =
   *  flat start, 2 = flat at both ends (another segment of the piece continues it). */
  add(t0: number, pivX: number, pivY: number, h: number, ax: number, ay: number, bx: number, by: number,
      ra: number, rb: number, fa: number, fb: number, r: number, g: number, b: number, a: number, glow: number,
      order: number, px: number, py: number, pf: number, heading: number, join = 0) {
    const d = this.d;
    let o = this.head * N;
    d[o++] = t0; d[o++] = pivX; d[o++] = pivY; d[o++] = h;
    d[o++] = ax; d[o++] = ay; d[o++] = bx; d[o++] = by;
    d[o++] = ra; d[o++] = rb; d[o++] = fa; d[o++] = fb;
    d[o++] = r; d[o++] = g; d[o++] = b; d[o++] = a;
    d[o++] = glow; d[o++] = order; d[o++] = px; d[o++] = py;
    d[o++] = pf; d[o++] = heading; d[o++] = join;
    this.head = (this.head + 1) % MAX;
    this.count = Math.min(MAX, this.count + 1);
  }

  clear() {
    this.count = this.head = 0;
  }

  /** Draw every piece still falling. downX, downY: world down in the layer's frame, per world unit.
   *  dry: the colour they turn toward. away: they drift straight out from (ox, oy), the point the
   *  tree grows from, with no gravity (growth.fallDirection). */
  draw(out: Instances, layer: number, alpha: number, downX: number, downY: number, now: number, dry: RGB, away = false, ox = 0, oy = 0) {
    const d = this.d;
    let alive = 0;
    for (let k = 0; k < this.count; k++) {
      const o = k * N;
      const age = now - d[o];
      const h = d[o + 3];
      const life = 1.3 + 0.6 * h;
      if (age < 0 || age >= life) continue;
      alive++;
      const u = age / life;
      const a = d[o + 15] * alpha * (1 - smooth((u - 0.35) / 0.65));
      if (a <= 0.01) continue;
      // Closed form (any frame rate places it alike): speeds up to a terminal speed, drifts and turns.
      const px = d[o + 1], py = d[o + 2];
      const ax = d[o + 4] - px, ay = d[o + 5] - py, bx = d[o + 6] - px, by = d[o + 7] - py;
      const [Dx, Dy] = fallDir(downX, downY, away, px, py, ox, oy);
      const vT = away ? 0.4 + 0.2 * h : 0.75 + 0.3 * h, kk = away ? 1.4 : 2.5;
      const fallD = vT * (age - (1 - Math.exp(-kk * age)) / kk);
      const drift = (away ? 0.15 : 0.12) * (h - 0.5) * age;
      const dx = Dx * fallD - Dy * drift, dy = Dy * fallD + Dx * drift;
      // Turn about the break: the loose end (the piece's middle, seen from the pivot) swings toward
      // the way it travels, then a slow tumble.
      const mx = 0.5 * (ax + bx), my = 0.5 * (ay + by);
      const swing = Math.atan2(mx * Dy - my * Dx, mx * Dx + my * Dy);
      const th = 0.85 * swing * (1 - Math.exp(-1.8 * age)) + (h - 0.5) * 0.7 * age, c = Math.cos(th), s = Math.sin(th);
      const m = 0.5 * Math.min(1, age / 0.8);
      // The motion frame stays put (the shaders take the random wind from the pivot point; a moving
      // one stuttered); the branch's bend fades out over the first half second (flex toward the
      // pivot's), so it does not jump as it lets go.
      const fe = smooth(age / 0.5), pf = d[o + 20];
      out.stroke(px + c * ax - s * ay + dx, py + s * ax + c * ay + dy, px + c * bx - s * by + dx, py + s * bx + c * by + dy,
        d[o + 8], d[o + 9], lerp(d[o + 10], pf, fe), lerp(d[o + 11], pf, fe),
        lerp(d[o + 12], dry[0], m), lerp(d[o + 13], dry[1], m), lerp(d[o + 14], dry[2], m), a, d[o + 16] * (1 - u), layer, d[o + 22],
        d[o + 17], d[o + 18], d[o + 19], pf, d[o + 21]);
    }
    if (!alive) this.clear();
  }
}
