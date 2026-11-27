export const deg = Math.PI / 180;
export const TAU = Math.PI * 2;

export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Where a piece that let go travels, in a layer's frame (growth.fallDirection): down (downX, downY,
 * world down per world unit), or (away) straight out from the point the tree grows from, (ox, oy)
 * in the same frame, seen from (x, y): no gravity. Same length as (downX, downY).
 */
export function fallDir(downX: number, downY: number, away: boolean, x: number, y: number, ox = 0, oy = 0): [number, number] {
  if (!away) return [downX, downY];
  const g = Math.hypot(downX, downY) || 1, dx = x - ox, dy = y - oy, r = Math.hypot(dx, dy);
  if (r < 1e-4) return [-downX, -downY];
  return [(dx / r) * g, (dy / r) * g];
}

/** Frame-rate independent exponential approach. */
export const damp = (current: number, target: number, rate: number, dt: number) =>
  lerp(current, target, 1 - Math.exp(-rate * dt));

/** Shortest-path angle interpolation (radians). */
export function angleLerp(a: number, b: number, t: number) {
  const d = ((((b - a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
  return a + d * t;
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export type Rng = ReturnType<typeof rng>;

export function hash1(n: number) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Smooth 1D value noise in -1..1. */
export function noise1(x: number, seed = 0) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash1(i + seed * 57.31), hash1(i + 1 + seed * 57.31), u) * 2 - 1;
}

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})/i.exec(hex);
  if (!m) return [1, 1, 1];
  const v = parseInt(m[1], 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

export function hsv2rgb(h: number, s: number, v: number): RGB {
  const f = (n: number) => {
    const k = (n + h * 6) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
}

/** MIDI pitch → 0..1 over the singing range C3..F6 (0 when unvoiced). */
export const pitchNorm = (midi: number) => (midi > 0 ? clamp((midi - 48) / (89 - 48)) : 0);

/** Rotate a #rrggbb colour's hue by `degrees`. */
export function hueShift(hex: string, degrees: number): string {
  const [r, g, b] = hexToRgb(hex);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > 1e-6) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  const s = max > 0 ? d / max : 0;
  const [nr, ng, nb] = hsv2rgb((((h + degrees / 360) % 1) + 1) % 1, s, max);
  const to = (v: number) => Math.round(clamp(v) * 255).toString(16).padStart(2, '0');
  return '#' + to(nr) + to(ng) + to(nb);
}
