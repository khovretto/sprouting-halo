// Colour system (docs/fable-consult-5-colour-themes-panel.md, A). Every instance gets its colour
// from a role (branches, leaves, accents, halo):
//   1. source: the take colour, the part's natural colour (theme), or a gradient at position
//      u = speed·t + perTake·take + voiceAmount·voice + along·s + scatter·(h − 0.5)
//   2. take mix: lerp toward the take colour, so takes keep their identity
//   3. look tint: lerp toward look.tint by look.tintAmount
// One Ink per layer and role is refilled every frame; no allocation per instance.

import { clamp, hexToRgb, RGB } from './math';
import type { Params } from './params';
import type { Drive } from './drive';
import { bakeGradient } from './gradient';

export type RoleId = 'colBranch' | 'colLeaf' | 'colAccent' | 'colHalo';
type RoleParams = Params['colBranch'];

export interface Ink {
  /** 256 × 3 when the source is a gradient. */
  lut: Float32Array | null;
  loop: boolean;
  /** Source 'theme': the caller passes the part's natural colour. */
  natural: boolean;
  take: RGB;
  takeMix: number;
  tint: RGB;
  tintK: number;
  u0: number;
  along: number;
  scatter: number;
  /** Mean colour (glow equalisation, commit effects). */
  mid: number[];
  /** Harmony (harmony.colour): how far the colour moves toward `mix`, and how that spreads.
   *  0 = everywhere alike, 1 = rising from root to tip, 2 = once round the halo ring and back. */
  mixK: number;
  mix: RGB;
  mixAlong: number;
  /** How the harmony colours blend (harmony.colourMix). */
  mixWay: MixWay;
  /** Harmony colour waves (harmony.colourMode 'waves'), or null. */
  wave: InkWave | null;
}

/** harmony.colourMix: how two colours blend. */
export type MixWay = 'oklab' | 'rgb' | 'light' | 'hue' | 'paint' | 'hard';

/**
 * Harmony colour waves on one tree or halo: bands of the other voice's colour travelling out from
 * where the wave starts (a tree's root; on the halo, points on the ring), a sine along the way:
 * 0 = this voice's own colour, 1 = the other's. Distances are in world units.
 */
export interface InkWave {
  other: RGB;
  /** How far the bands go toward the other colour (harmony.colour × harmony). */
  k: number;
  /** Seconds since the waves started, and how much later they reach this one. */
  age: number;
  delay: number;
  /** The wave the other way up (the voice that leads, in step with the one that follows). */
  invert: boolean;
  length: number;
  speed: number;
  /** Tree: distance = s × scale (s 0 root .. 1 tip). Ring: from the start angles, × scale (R),
   *  plus offset (how far the waves have come before they reach the ring). */
  ring: boolean;
  scale: number;
  starts: number[];
  offset: number;
}

export const newInk = (): Ink => ({
  lut: null, loop: false, natural: false, take: [1, 1, 1], takeMix: 1,
  tint: [1, 1, 1], tintK: 0, u0: 0, along: 0, scatter: 0, mid: [1, 1, 1],
  mixK: 0, mix: [1, 1, 1], mixAlong: 0, mixWay: 'oklab', wave: null,
});

/** Where the next colours are taken (layer-local; halo layers: the ring is the unit circle). Only
 *  harmony waves round the halo read it; the halo's drawing sets it for each point. */
export const inkPt = { x: 1, y: 0 };

const TAU = Math.PI * 2;
/** 0..1 at a point: how far toward the other colour the wave is there. */
export function waveAt(w: InkWave, s: number) {
  let d: number;
  if (w.ring) {
    const a = Math.atan2(inkPt.y, inkPt.x);
    d = Math.PI;
    for (const a0 of w.starts) {
      let x = (a - a0) % TAU;
      if (x < 0) x += TAU;
      d = Math.min(d, x > Math.PI ? TAU - x : x);
    }
    d = d * w.scale + w.offset;
  } else d = Math.max(0, s) * w.scale;
  // Ahead of its front: still this voice's own colour (a soft edge, a third of a wave wide).
  const L = Math.max(0.02, w.length), run = w.speed * (w.age - w.delay) - d;
  if (run <= 0) return 0;
  const front = Math.min(1, run / (0.33 * L));
  // Out from the start, 0 at the front (the leader's front is half a wave later, the wave the
  // other way up, so both show the same bands).
  const p = 0.5 - 0.5 * Math.cos((TAU * (w.speed * w.age - d)) / L);
  return front * (w.invert ? 1 - p : p);
}

// ---- Mixing two colours (harmony.colourMix) ---------------------------------------------------
const toLin = (c: number) => (c <= 0 ? 0 : Math.pow(c, 2.2));
const toGam = (c: number) => (c <= 0 ? 0 : Math.pow(c, 1 / 2.2));
const labA = [0, 0, 0], labB = [0, 0, 0];
/** Display colour 0..1 → OKLab. */
function oklab(r: number, g: number, b: number, out: number[]) {
  r = toLin(r);
  g = toLin(g);
  b = toLin(b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  out[0] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  out[1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  out[2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
}
function fromOklab(L: number, A: number, B: number, out: number[]) {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  out[0] = toGam(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  out[1] = toGam(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  out[2] = toGam(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
}
const hsvA = [0, 0, 0], hsvB = [0, 0, 0];
function hsv(r: number, g: number, b: number, out: number[]) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-6) h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  out[0] = h * 60;
  out[1] = mx > 1e-6 ? d / mx : 0;
  out[2] = mx;
}
// The painter's wheel (red, yellow, blue): yellow and blue make green, red and blue violet.
const RGB_H = [0, 60, 120, 240, 360], RYB_H = [0, 120, 180, 240, 360];
const remap = (h: number, from: number[], to: number[]) => {
  for (let i = 1; i < from.length; i++)
    if (h <= from[i]) return to[i - 1] + ((h - from[i - 1]) / (from[i] - from[i - 1])) * (to[i] - to[i - 1]);
  return h;
};
/** Shortest way round from h0 to h1 (degrees), w of the way. */
const hueLerp = (h0: number, h1: number, w: number) => {
  const d = ((((h1 - h0) % 360) + 540) % 360) - 180;
  return (((h0 + d * w) % 360) + 360) % 360;
};
const HSV_TO: [number, number, number][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];

/** a → b, w of the way (0..1), the way harmony.colourMix says, into out (may be a). */
export function mixColours(a: ArrayLike<number>, b: ArrayLike<number>, w: number, way: MixWay, out: number[]) {
  const a0 = a[0], a1 = a[1], a2 = a[2];
  if (w <= 0) {
    out[0] = a0;
    out[1] = a1;
    out[2] = a2;
    return out;
  }
  switch (way) {
    case 'hard':
      // A hard cut: one colour or the other, nothing between.
      if (w >= 0.5) {
        out[0] = b[0];
        out[1] = b[1];
        out[2] = b[2];
      } else {
        out[0] = a0;
        out[1] = a1;
        out[2] = a2;
      }
      return out;
    case 'rgb':
      out[0] = a0 + (b[0] - a0) * w;
      out[1] = a1 + (b[1] - a1) * w;
      out[2] = a2 + (b[2] - a2) * w;
      return out;
    case 'light':
      // As light adds up: brighter on the way than a straight blend.
      out[0] = toGam(toLin(a0) + (toLin(b[0]) - toLin(a0)) * w);
      out[1] = toGam(toLin(a1) + (toLin(b[1]) - toLin(a1)) * w);
      out[2] = toGam(toLin(a2) + (toLin(b[2]) - toLin(a2)) * w);
      return out;
    case 'paint': {
      // Round the painter's wheel, a little muddier half way (as paints get).
      hsv(a0, a1, a2, hsvA);
      hsv(b[0], b[1], b[2], hsvB);
      const ha = remap(hsvA[0], RGB_H, RYB_H), hb = remap(hsvB[0], RGB_H, RYB_H);
      // A grey has no hue of its own: it takes the other's.
      const h = hsvA[1] < 0.05 ? hb : hsvB[1] < 0.05 ? ha : hueLerp(ha, hb, w);
      const mid = 4 * w * (1 - w);
      const sat = (hsvA[1] + (hsvB[1] - hsvA[1]) * w) * (1 - 0.3 * mid), val = (hsvA[2] + (hsvB[2] - hsvA[2]) * w) * (1 - 0.12 * mid);
      const hh = remap(h, RYB_H, RGB_H) / 60, i = Math.floor(hh) % 6, f = hh - Math.floor(hh);
      const p = val * (1 - sat), q = val * (1 - sat * f), tt = val * (1 - sat * (1 - f));
      const T = HSV_TO;
      T[0][0] = val; T[0][1] = tt; T[0][2] = p;
      T[1][0] = q; T[1][1] = val; T[1][2] = p;
      T[2][0] = p; T[2][1] = val; T[2][2] = tt;
      T[3][0] = p; T[3][1] = q; T[3][2] = val;
      T[4][0] = tt; T[4][1] = p; T[4][2] = val;
      T[5][0] = val; T[5][1] = p; T[5][2] = q;
      out[0] = T[i][0];
      out[1] = T[i][1];
      out[2] = T[i][2];
      return out;
    }
    case 'hue': {
      // Round the colour wheel (OKLCH, the short way): every colour between at full strength.
      oklab(a0, a1, a2, labA);
      oklab(b[0], b[1], b[2], labB);
      const ca = Math.hypot(labA[1], labA[2]), cb = Math.hypot(labB[1], labB[2]);
      const ha = Math.atan2(labA[2], labA[1]), hb = Math.atan2(labB[2], labB[1]);
      let dh = hb - ha;
      dh -= TAU * Math.round(dh / TAU);
      const h = ca < 0.02 ? hb : cb < 0.02 ? ha : ha + dh * w;
      const L = labA[0] + (labB[0] - labA[0]) * w, C = ca + (cb - ca) * w;
      fromOklab(L, C * Math.cos(h), C * Math.sin(h), out);
      return out;
    }
    default: {
      // OKLab: an even, perceptual blend (no grey or dark band half way).
      oklab(a0, a1, a2, labA);
      oklab(b[0], b[1], b[2], labB);
      fromOklab(labA[0] + (labB[0] - labA[0]) * w, labA[1] + (labB[1] - labA[1]) * w, labA[2] + (labB[2] - labA[2]) * w, out);
      return out;
    }
  }
}

const voiceOf = (d: Drive | undefined, v: string) =>
  !d || v === 'none' ? 0 : v === 'pitch' ? d.pitch : v === 'loudness' ? d.energy : v === 'effort' ? d.effort
    : v === 'breath' ? d.breath : v === 'vibrato' ? d.vibrato : v === 'flash' ? d.flash : 0;

/** Fill `ink` for one layer. `take` is the untinted take colour; `k` the take index. */
export function setInk(ink: Ink, p: Params, role: RoleId, take: RGB, k: number, t: number, d?: Drive, override?: string): Ink {
  let r = p[role] as RoleParams;
  if (role === 'colHalo' && (r.source as string) === 'branches') r = p.colBranch;
  // The halo is a ring: its gradient fits round it a whole number of times (at least once), or it
  // shows a hard seam where the ring closes (e.g. 0.3 of a gradient taken over from the branches).
  const alongOf = (a: number) => (role === 'colHalo' && a !== 0 ? (a < 0 ? -1 : 1) * Math.max(1, Math.round(Math.abs(a))) : a);
  ink.take = take;
  ink.mixK = 0;
  ink.wave = null;
  ink.tint = hexToRgb(p.look.tint);
  ink.tintK = clamp(p.look.tintAmount);
  if (override && (role === 'colBranch' || role === 'colHalo')) {
    // The track's own gradient (Sprout Tap "My gradient"), moved by the look's movers.
    const b = bakeGradient(override, take);
    ink.lut = b.lut;
    ink.loop = b.loop;
    ink.natural = false;
    ink.takeMix = 0;
    ink.u0 = r.speed * t + r.voiceAmount * voiceOf(d, r.voice);
    ink.along = alongOf(r.along || 1);
    ink.scatter = 0;
    inkAt(ink, 0.5, 0.5, ink.mid);
    return ink;
  }
  ink.natural = r.source === 'theme';
  ink.takeMix = r.source === 'take' ? 1 : clamp(r.takeMix);
  ink.lut = null;
  if (r.source === 'gradient') {
    const b = bakeGradient(r.gradient, take);
    ink.lut = b.lut;
    ink.loop = b.loop;
    ink.u0 = r.speed * t + r.perTake * k + r.voiceAmount * voiceOf(d, r.voice);
    ink.along = alongOf(r.along);
    ink.scatter = r.scatter;
    inkAt(ink, 0.5, 0.5, ink.mid);
  } else {
    ink.loop = false;
    inkAt(ink, 0, 0.5, ink.mid);
  }
  return ink;
}

/**
 * Colour at a point into `out`. s: 0 root .. 1 tip (ring: angle / TAU). h: per-leaf random 0..1.
 * natural: the part's natural colour (source 'theme'). natScale: per-leaf variety of the mix.
 * gain: brightness multiplier.
 */
export function inkAt(ink: Ink, s: number, h: number, out: number[], natural?: RGB, natScale = 1, gain = 1) {
  let r: number, g: number, b: number;
  const lut = ink.lut;
  if (lut) {
    let u = ink.u0 + ink.along * s + ink.scatter * (h - 0.5);
    if (ink.loop) u -= Math.floor(u);
    else {
      u = Math.abs(u) % 2;
      if (u > 1) u = 2 - u;
    }
    const i = Math.min(255, (u * 256) | 0) * 3;
    r = lut[i];
    g = lut[i + 1];
    b = lut[i + 2];
  } else if (ink.natural && natural) {
    r = natural[0];
    g = natural[1];
    b = natural[2];
  } else {
    r = ink.take[0];
    g = ink.take[1];
    b = ink.take[2];
  }
  // takeMix 0 is none at all ("0 = pure gradient or natural colour"); unchanged from 0.1 up
  // (consult 8, 2.1: per-leaf variety used to leak up to 40 % take colour at 0).
  const m = ink.takeMix >= 1 ? 1 : (1 - clamp((1 - ink.takeMix) * natScale)) * Math.min(1, ink.takeMix * 10);
  const k = ink.tintK, a = (1 - m) * (1 - k), tk = m * (1 - k), kk = k;
  out[0] = r * a + ink.take[0] * tk + ink.tint[0] * kk;
  out[1] = g * a + ink.take[1] * tk + ink.tint[1] * kk;
  out[2] = b * a + ink.take[2] * tk + ink.tint[2] * kk;
  // Harmony. A hard cut switches where the wave (or gradient) is half way, then goes as far
  // toward the other colour as the amount says (leaves and blossoms half as far).
  const hard = ink.mixWay === 'hard';
  if (ink.wave) {
    // Waves: bands of the other voice's colour running out along it.
    const w = ink.wave, x = waveAt(w, s);
    if (hard ? x >= 0.5 : x * w.k > 0.002) mixColours(out, w.other, hard ? w.k : x * w.k, hard ? 'oklab' : ink.mixWay, out);
  } else if (ink.mixK > 0) {
    // Toward the colour shared with the other voice.
    const sp = ink.mixAlong === 1 ? clamp(s) : ink.mixAlong === 2 ? 0.5 - 0.5 * Math.cos(s * Math.PI * 2) : 1;
    if (hard ? sp >= 0.5 : sp * ink.mixK > 0.002) mixColours(out, ink.mix, hard ? ink.mixK : sp * ink.mixK, hard ? 'oklab' : ink.mixWay, out);
  }
  if (gain !== 1) {
    out[0] *= gain;
    out[1] *= gain;
    out[2] *= gain;
  }
  return out;
}

/** Ring position for the halo (vine and ring agree): angle → 0..1, or 0..2 there-and-back. */
export const ringS = (x: number, y: number, loop: boolean) => (Math.atan2(y, x) / (Math.PI * 2) + 0.5) * (loop ? 1 : 2);
