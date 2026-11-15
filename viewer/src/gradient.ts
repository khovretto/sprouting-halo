// Gradients as one string (docs/fable-consult-5-colour-themes-panel.md, B.1):
//   interp [ "~" ] ";" pos:colour { "," pos:colour }
//   interp: rgb (linear) | ok (OKLab, smooth, no grey middle) | step; "~" = loop (wraps round)
//   colour: 6 hex digits, or "t" = the take colour
// A string changes atomically over settings sync and in presets; it never starts with "#" (the
// panel would turn it into a colour picker).

import { hexToRgb, RGB } from './math';

export interface Stop {
  pos: number;
  /** 'rrggbb' or 't' (the take colour). */
  col: string;
}
export interface Gradient {
  interp: 'rgb' | 'ok' | 'step';
  loop: boolean;
  stops: Stop[];
}
export interface Baked {
  lut: Float32Array;
  loop: boolean;
}

export function parseGradient(s: string): Gradient {
  const m = /^(rgb|ok|step)(~?);(.*)$/.exec(String(s).trim().toLowerCase());
  const stops: Stop[] = [];
  for (const part of (m ? m[3] : '').split(',')) {
    const q = /^([0-9.]+):([0-9a-f]{6}|t)$/.exec(part.trim());
    if (q && stops.length < 12) stops.push({ pos: Math.min(1, Math.max(0, +q[1])), col: q[2] });
  }
  if (!stops.length) stops.push({ pos: 0, col: 'ffffff' });
  stops.sort((a, b) => a.pos - b.pos);
  return { interp: (m?.[1] as Gradient['interp']) ?? 'ok', loop: m?.[2] === '~', stops };
}

export const formatGradient = (g: Gradient) =>
  `${g.interp}${g.loop ? '~' : ''};` +
  [...g.stops].sort((a, b) => a.pos - b.pos).map((s) => `${+s.pos.toFixed(3)}:${s.col}`).join(',');

// OKLab (Björn Ottosson). The app treats #rrggbb / 255 as its working values; convert through
// linear light only here.
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const gam = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055);
function toOk([r, g, b]: RGB): RGB {
  r = lin(r);
  g = lin(g);
  b = lin(b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function fromOk([L, a, b]: RGB): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const c = (v: number) => Math.min(1, Math.max(0, gam(v)));
  return [c(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    c(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    c(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)];
}

const cache = new Map<string, Baked>();
/** A 256-entry colour table for the gradient (cached by string, and take colour when it uses "t"). */
export function bakeGradient(str: string, take: RGB): Baked {
  const usesTake = str.includes(':t');
  const key = usesTake ? `${str}|${take.map((v) => Math.round(v * 255)).join(',')}` : str;
  let b = cache.get(key);
  if (b) return b;
  if (cache.size > 64) cache.clear();
  const g = parseGradient(str), n = g.stops.length;
  const cols = g.stops.map((s) => (s.col === 't' ? take : hexToRgb('#' + s.col)));
  const work = g.interp === 'ok' ? cols.map(toOk) : cols;
  const lut = new Float32Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const u = g.loop ? i / 256 : i / 255;
    let j = 0;
    while (j < n && g.stops[j].pos <= u) j++; // first stop after u
    let i0 = j - 1, i1 = j, p0: number, p1: number;
    if (g.loop) {
      p0 = i0 < 0 ? g.stops[n - 1].pos - 1 : g.stops[i0].pos;
      p1 = i1 >= n ? g.stops[0].pos + 1 : g.stops[i1].pos;
      i0 = (i0 + n) % n;
      i1 %= n;
    } else {
      i0 = Math.max(0, i0);
      i1 = Math.min(n - 1, i1);
      p0 = g.stops[i0].pos;
      p1 = g.stops[i1].pos;
    }
    const f = g.interp === 'step' || p1 - p0 < 1e-6 ? 0 : (u - p0) / (p1 - p0);
    const a = work[i0], c = work[i1];
    const mix: RGB = [a[0] + (c[0] - a[0]) * f, a[1] + (c[1] - a[1]) * f, a[2] + (c[2] - a[2]) * f];
    lut.set(g.interp === 'ok' ? fromOk(mix) : mix, i * 3);
  }
  cache.set(key, (b = { lut, loop: g.loop }));
  return b;
}

export const RAINBOW = 'rgb~;0:ff4d4d,0.167:ffff4d,0.333:4dff4d,0.5:4dffff,0.667:4d4dff,0.833:ff4dff';

export const GRADIENT_PRESETS: Record<string, string> = {
  Rainbow: RAINBOW,
  'Rainbow (vivid)': 'rgb~;0:ff0000,0.167:ffff00,0.333:00ff00,0.5:00ffff,0.667:0000ff,0.833:ff00ff',
  'Pastel rainbow': 'rgb~;0:ffa6a6,0.167:ffffa6,0.333:a6ffa6,0.5:a6ffff,0.667:a6a6ff,0.833:ffa6ff',
  'Natural green': 'ok;0:1f6b2e,0.5:52c757,1:b5e61d',
  Autumn: 'ok;0:7a1f0e,0.4:d9541e,0.7:f2a51e,1:f7dc6f',
  Fire: 'ok;0:3a0a00,0.35:c21a00,0.65:ff7a00,0.9:ffd84a,1:fff6cf',
  Ice: 'ok;0:0b2a6b,0.4:2f7fe0,0.75:8fe3ff,1:f2fdff',
  Sakura: 'ok;0:ff7ac8,0.6:ffd1e6,1:ffffff',
  Sunset: 'ok;0:2b1b6b,0.4:c2338f,0.7:ff7a59,1:ffd36b',
  Neon: 'rgb~;0:ff2bd6,0.33:2bd9ff,0.66:7dff2b',
  'Take to white': 'ok;0:t,1:ffffff',
  'Dark to take': 'ok;0:101018,0.6:t,1:t',
  'Single colour': 'ok;0:ffffff',
};
