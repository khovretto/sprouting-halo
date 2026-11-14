// Motion state on the CPU (docs/fable-consult-3-motion.md, 1.3 and 2.6): per layer, three damped
// springs (limb 0.75 Hz, shoot 1.7 Hz, twig 3.3 Hz) whose state is a lean vector in the world.
// A wandering wind whose strength is the loudness pushes them; every note start kicks them; the
// limb's acceleration throws the thinner parts back (follow-through). The vibrato phase is
// integrated here so a changing rate never jumps. The shaders (shaders/motion.glsl) add the gust
// field, per-shoot noise, the shiver and leaf flutter.

import type { Drive } from './drive';
import type { Params } from './params';
import { clamp, deg, lerp, noise1, TAU } from './math';

const F0 = [0.75, 1.7, 3.3]; // Hz: limb, shoot, twig
const ZETA = [0.28, 0.2, 0.16]; // damping ratios at springiness 0.5
const KICK = [1, 0.8, 0.6]; // share of a note-start push each spring takes
const LAG = [0, 0.5, 0.8]; // how much the limb's acceleration throws the thinner parts back
const KICK_UP = 35 * deg;

/** One for the scene: the wind clock. */
export class Wind {
  /** Wrapped at 4096 (shader). */
  t = 0;
  /** Not wrapped (CPU noise). */
  raw = 0;
  update(dt: number, p: Params) {
    const d = dt * p.motion.speed;
    this.raw += d;
    this.t = (this.t + d) % 4096;
  }
}

/** One per layer (take slot, halo), next to its Drive. */
export class LayerMotion {
  private x = new Float64Array(6); // lean per spring: limb.xy, shoot.xy, twig.xy
  private v = new Float64Array(6);
  private phase = 0;
  private flip = 1;
  readonly a = new Float32Array(4);
  readonly b = new Float32Array(4);
  readonly c = new Float32Array(4);

  constructor(private seed: number) {}

  /** An outside push (radians at the tips), e.g. the commit impact. */
  push(jx: number, jy: number) {
    for (let i = 0; i < 3; i++) {
      const w = TAU * F0[i];
      this.v[2 * i] += jx * w * KICK[i];
      this.v[2 * i + 1] += jy * w * KICK[i];
    }
  }

  /** scale: 1 for plants, about 0.6 for the halo. ring: the halo's oval / trefoil mode. */
  update(d: Drive, wind: Wind, dt: number, p: Params, scale: number, ring: boolean) {
    const m = p.motion;
    const amp = m.swayDeg * deg * scale * (m.idle + (1 - m.idle) * clamp(d.slow * 1.5));

    // Wind: sideways, wandering from one side through calm to the other; mostly shared by all layers.
    const side = clamp(2.2 * (0.6 * noise1(wind.raw * 0.11, 3) + 0.4 * noise1(wind.raw * 0.17, 10 + this.seed)), -1, 1);
    // Swell: louder than the running mean lifts the boughs, a fading note lets them sag.
    const swell = clamp((d.energy - d.slow) * 2, -1, 1);
    const fx = 0.8 * amp * side;
    const fy = amp * (0.6 * swell + 0.2 * noise1(wind.raw * 0.23, 40 + this.seed));

    // A note start is a push with the wind and upward.
    if (d.onset && dt > 0) {
      const j = m.kickDeg * deg * scale * (0.35 + 0.65 * d.effort) * (0.5 + 0.5 * clamp(d.level * 1.5));
      let sgn = Math.sign(side);
      if (Math.abs(side) < 0.15) sgn = this.flip = -this.flip;
      this.push(sgn * Math.cos(KICK_UP) * j, Math.sin(KICK_UP) * j);
    }

    // Springs (semi-implicit Euler, at most 1/120 s per step).
    const zMul = lerp(2.2, 0.55, clamp(m.springiness)) * (1 + 0.8 * d.softness);
    const steps = Math.min(16, Math.max(1, Math.ceil(dt * 120)));
    const h = Math.min(dt, 0.25) / steps;
    for (let s = 0; s < steps && h > 0; s++) {
      for (let c = 0; c < 2; c++) {
        const F = c ? fy : fx;
        let a0 = 0;
        for (let i = 0; i < 3; i++) {
          const w = TAU * F0[i], k = 2 * i + c;
          const acc = w * w * (F - this.x[k]) - 2 * ZETA[i] * zMul * w * this.v[k] - LAG[i] * a0;
          if (i === 0) a0 = acc;
          this.v[k] += acc * h;
          this.x[k] += this.v[k] * h;
        }
      }
    }

    // Vibrato: integrate the phase so a changing rate never jumps.
    this.phase = (this.phase + TAU * (d.vibratoRate || 5.5) * dt) % TAU;

    this.a.set([this.x[0], this.x[1], this.x[2], this.x[3]]);
    this.b.set([this.x[4], this.x[5], 0.45 * amp, this.phase]);
    this.c.set([
      m.shiver ? m.shiverDeg * deg * d.vibrato * scale : 0,
      m.flutterDeg * deg * Math.min(1.5, m.idle + (1 - m.idle) * clamp(d.energy * 1.3) + 0.5 * d.breath),
      m.twigs,
      ring ? 1 : 0,
    ]);
  }
}
