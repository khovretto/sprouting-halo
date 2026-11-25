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
}

export const newInk = (): Ink => ({
  lut: null, loop: false, natural: false, take: [1, 1, 1], takeMix: 1,
  tint: [1, 1, 1], tintK: 0, u0: 0, along: 0, scatter: 0, mid: [1, 1, 1],
  mixK: 0, mix: [1, 1, 1], mixAlong: 0,
});

const voiceOf = (d: Drive | undefined, v: string) =>
  !d || v === 'none' ? 0 : v === 'pitch' ? d.pitch : v === 'loudness' ? d.energy : v === 'effort' ? d.effort
    : v === 'breath' ? d.breath : v === 'vibrato' ? d.vibrato : v === 'flash' ? d.flash : 0;

/** Fill `ink` for one layer. `take` is the untinted take colour; `k` the take index. */
export function setInk(ink: Ink, p: Params, role: RoleId, take: RGB, k: number, t: number, d?: Drive, override?: string): Ink {
  let r = p[role] as RoleParams;
  if (role === 'colHalo' && (r.source as string) === 'branches') r = p.colBranch;
  ink.take = take;
  ink.mixK = 0;
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
    ink.along = r.along || 1;
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
    ink.along = r.along;
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
  const k = ink.tintK, a = (1 - m) * (1 - k) * gain, tk = m * (1 - k) * gain, kk = k * gain;
  out[0] = r * a + ink.take[0] * tk + ink.tint[0] * kk;
  out[1] = g * a + ink.take[1] * tk + ink.tint[1] * kk;
  out[2] = b * a + ink.take[2] * tk + ink.tint[2] * kk;
  if (ink.mixK > 0) {
    // Harmony: toward the colour shared with the other voice.
    const sp = ink.mixAlong === 1 ? clamp(s) : ink.mixAlong === 2 ? 0.5 - 0.5 * Math.cos(s * Math.PI * 2) : 1;
    const w = ink.mixK * sp, mx = ink.mix;
    out[0] += (mx[0] * gain - out[0]) * w;
    out[1] += (mx[1] * gain - out[1]) * w;
    out[2] += (mx[2] * gain - out[2]) * w;
  }
  return out;
}

/** Ring position for the halo (vine and ring agree): angle → 0..1, or 0..2 there-and-back. */
export const ringS = (x: number, y: number, loop: boolean) => (Math.atan2(y, x) / (Math.PI * 2) + 0.5) * (loop ? 1 : 2);
