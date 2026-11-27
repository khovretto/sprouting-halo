// Falling twigs: branch pieces that broke off ("fall away": growth.onPause / onPhraseEnd / onStop).
// A piece is a run of segments of one branch; they fall together and fade, turning about the point
// where the piece broke off so that its loose end swings the way it falls (down, or with
// growth.fallDirection "away", straight out from where the tree grows), with a little tumble. One pool per plant, in
// the plant's local frame.

import type { Instances } from './render/renderer';
import { carried, fallDir, flightDist, flightSpeed, lerp, RGB } from './math';

const MAX = 1536; // segments
const N = 31; // floats per segment

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
    // Its flight so far (set when first drawn; again when growth.fallDirection changes in flight):
    // which way (-1 not yet), from what age, how far it had come, the speed it carried, how far
    // it had turned toward the way it went.
    d[o++] = -1; d[o++] = 0; d[o++] = 0; d[o++] = 0; d[o++] = 0; d[o++] = 0; d[o++] = 0;
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
      // Which way it falls changed in flight (a preset): it carries on from where it is, with the
      // speed it had, and turns toward the new way from how far it had turned.
      if (d[o + 23] !== (away ? 1 : 0)) {
        if (d[o + 23] >= 0) {
          const f = this.flight(o, age, d[o + 23] === 1, downX, downY, ox, oy);
          d[o + 25] = f[0]; d[o + 26] = f[1]; d[o + 27] = f[2]; d[o + 28] = f[3]; d[o + 29] = f[4];
          d[o + 24] = age;
        }
        d[o + 23] = away ? 1 : 0;
      }
      const f = this.flight(o, age, away, downX, downY, ox, oy);
      const dx = f[0], dy = f[1];
      const th = f[4] + (h - 0.5) * 0.7 * age, c = Math.cos(th), s = Math.sin(th);
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

  /** Segment o at `age` in its current flight: how far it has come [dx, dy], its velocity, and how
   *  far it has turned toward the way it travels (its loose end, the segment's middle seen from
   *  the break, swings that way; the slow tumble comes on top). */
  private flight(o: number, age: number, away: boolean, downX: number, downY: number, ox: number, oy: number) {
    const d = this.d, h = d[o + 3], px = d[o + 1], py = d[o + 2];
    const t1 = d[o + 24], ox1 = d[o + 25], oy1 = d[o + 26], tau = Math.max(0, age - t1);
    const [Dx, Dy] = fallDir(downX, downY, away, px + ox1, py + oy1, ox, oy);
    const vT = away ? 0.4 + 0.2 * h : 0.75 + 0.3 * h, kk = away ? 1.4 : 2.5;
    const along = flightDist(vT, kk, tau), sp = flightSpeed(vT, kk, tau);
    const dr = (away ? 0.15 : 0.12) * (h - 0.5);
    const c = carried(kk, tau), keep = Math.exp(-kk * tau);
    const mx = 0.5 * (d[o + 4] + d[o + 6]) - px, my = 0.5 * (d[o + 5] + d[o + 7]) - py;
    const swing = Math.atan2(mx * Dy - my * Dx, mx * Dx + my * Dy);
    const turn = d[o + 29] + (0.85 * swing - d[o + 29]) * (1 - Math.exp(-1.8 * tau));
    return [
      ox1 + Dx * along - Dy * dr * tau + d[o + 27] * c, oy1 + Dy * along + Dx * dr * tau + d[o + 28] * c,
      Dx * sp - Dy * dr + d[o + 27] * keep, Dy * sp + Dx * dr + d[o + 28] * keep, turn,
    ];
  }
}
