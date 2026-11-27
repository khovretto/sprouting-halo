// Glow that travels (glow.travel): a layer's glow over the last few seconds, so a point further
// from where it grows shows the glow from a moment earlier. A swell of the voice then runs up a
// branch from root to tip (and round the halo from where it grows), instead of the whole tree
// lighting up at once.

const STEP = 1 / 120; // seconds between kept values
const CAP = 512; // about 4.3 s

export class GlowTrail {
  private v = new Float32Array(CAP);
  private head = -1;
  private t0 = 0;

  /** The glow now (at sim time t); called every frame, more than once in a frame is fine. */
  push(t: number, value: number) {
    if (this.head < 0 || t < this.t0 - 1e-6 || t - this.t0 > CAP * STEP) {
      // first value, or time jumped (restart, a long pause): the past is this value
      this.v.fill(value);
      this.head = 0;
      this.t0 = t;
      return;
    }
    const n = Math.floor((t - this.t0) / STEP);
    if (n <= 0) {
      this.v[this.head] = value;
      return;
    }
    const last = this.v[this.head];
    for (let k = 1; k <= n; k++) {
      this.head = (this.head + 1) % CAP;
      this.v[this.head] = last + ((value - last) * k) / n;
    }
    this.t0 += n * STEP;
  }

  /** The glow `ago` seconds back. */
  at(ago: number) {
    if (this.head < 0) return 0;
    const x = Math.min(CAP - 2, Math.max(0, ago / STEP)), i = Math.floor(x), f = x - i;
    const a = this.v[(this.head - i + CAP) % CAP], b = this.v[(this.head - i - 1 + CAP) % CAP];
    return a + (b - a) * f;
  }
}
