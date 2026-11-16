// Decorations (themes): leaves + blossoms, thorns, or a Christmas wreath (pine needles, berries,
// holly). Placed deterministically on branch nodes (a hash of the node index, so they don't
// flicker), sized by how revealed that node is, and dropped with a fall animation when pruned.
// Shapes are drawn in shaders/sprite.frag.

import type { Params } from './params';
import type { Theme } from './features';
import type { Instances } from './render/renderer';
import type { Skeleton } from './growth/skeleton';
import { clamp, hash1, lerp, RGB } from './math';
import { Ink, inkAt } from './colour';
import { customDef, MOVES, shapeId, ThemeDef, ThemePart } from './themes';
import { bakeGradient } from './gradient';
import type { ShedPool } from './shed';
import { hexToRgb } from './math';

const enum Shape {
  Leaf = 0,
  Thorn = 1,
  Berry = 2,
  Needle = 3,
  Holly = 4,
  Blossom = 5,
}

// Natural colours of the built-in parts (used when a colour role's source is "theme").
const LEAF: RGB = [0.32, 0.78, 0.34];
const PETAL: RGB = [1.0, 0.82, 0.9];
const THORN: RGB = [0.92, 0.86, 0.7];
const PINE: RGB = [0.16, 0.55, 0.3];
const HOLLY: RGB = [0.1, 0.45, 0.2];
const BERRY: RGB = [0.9, 0.08, 0.14];

export interface DecoStyle {
  /** Per-track look (from the tap plugin, or the viewer fallback): a built-in or user theme id. */
  theme: Theme | string;
  density: number;
  layer: number;
  /** Colour roles for leaves (and thorns, needles, holly) and accents (blossoms, berries). */
  leaf: Ink;
  accent: Ink;
  /** Node flex → 0 (root) .. 1 (tip) for the colour along a branch. */
  sScale: number;
  alpha: number;
  glow: number;
  /** Sizes are divided by this (the halo is built in unit-circle space). */
  unit: number;
  /** Extra size factor (the small resting halo gets smaller leaves). */
  sizeMul?: number;
  seed: number;
  effort: number;
  /** 0..1: blossoms open (full / high singing). */
  bloom: number;
  /** 0..1 prune progress: decorations fall and fade. */
  fall: number;
  /** World "down" expressed in the layer's local frame (per world unit). */
  downX: number;
  downY: number;
  intensity: number;
  /** Sim time and the voice's pitch 0..1 (a theme's moving natural gradient). */
  time?: number;
  pitch?: number;
}

let tipScratch = new Uint8Array(0);
/** Take plants: 1 = blossom site (a twig end with a flower, no leaf), 2 = the node before one. */
let bloomSite = new Uint8Array(0);
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** Leaves on take trees unfurl smoothly as their twig grows (no springy overshoot). */
const unfurl = (t: number) => 1 - Math.pow(1 - t, 2.5);

const easeOutBack = (t: number) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};

const TAU2 = Math.PI * 2;
let dryKey = '', dryRgb: RGB = [0.54, 0.44, 0.27];
/** look.dryColour as RGB (cached). */
function dryOf(p: Params): RGB {
  if (p.look.dryColour !== dryKey) {
    dryKey = p.look.dryColour;
    dryRgb = hexToRgb(dryKey);
  }
  return dryRgb;
}
const natCache = new Map<string, RGB>();
const natScratch: RGB = [1, 1, 1];
/** A part's natural colour as RGB: one colour (cached), or a point of its gradient moved by part.move. */
function natAt(part: ThemePart, st: DecoStyle, s: number, h: number): RGB {
  if (!part.natural.includes(';')) return natOf(part);
  const mv = MOVES[part.move ?? 'Sparkle'] ?? MOVES.Sparkle;
  const b = bakeGradient(part.natural, [1, 1, 1]);
  let u = mv.speed * (st.time ?? 0) + mv.along * s + mv.scatter * (h - 0.5) + mv.pitch * (st.pitch ?? 0);
  u = b.loop ? u - Math.floor(u) : clamp(u + (mv.scatter > 0 ? 0.5 : 0));
  const x = Math.min(255, Math.max(0, Math.round(u * 255))) * 3;
  natScratch[0] = b.lut[x];
  natScratch[1] = b.lut[x + 1];
  natScratch[2] = b.lut[x + 2];
  return natScratch;
}
/** A part's single natural colour as RGB (cached). */
function natOf(part: ThemePart): RGB {
  let c = natCache.get(part.natural);
  if (!c) {
    const m = /^#?([0-9a-f]{6})/i.exec(part.natural);
    const v = m ? parseInt(m[1], 16) : 0xffffff;
    c = [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
    natCache.set(part.natural, c);
  }
  return c;
}
export type { ThemeDef };
/** A part's colour from its role (natural colour, natScale variety, brightness gain). */
const col = (ink: Ink, natural: RGB, s: number, h: number, natScale: number, gain: number) =>
  inkAt(ink, s, h, tintA, natural, natScale, gain) as [number, number, number];

// Scratch colours: Placer.put copies the numbers at once, so one shared array per use is safe.
const tintA: [number, number, number] = [0, 0, 0], tintB: [number, number, number] = [0, 0, 0];
function tint(base: RGB, natural: RGB, amount: number, intensity: number, out = tintA): [number, number, number] {
  out[0] = lerp(base[0], natural[0], amount) * intensity;
  out[1] = lerp(base[1], natural[1], amount) * intensity;
  out[2] = lerp(base[2], natural[2], amount) * intensity;
  return out;
}

class Placer {
  /** Extra per-node opacity (the halo vine's fading tail). */
  nodeAlpha = 1;
  /** Motion frame of the current node: order and the shoot's pivot x, y, flex, heading (null = rigid at the point). */
  frame: [number, number, number, number, number] | null = null;
  /** Set for one put(): that decoration lets go and falls (drawn by the pool from now on). */
  drop: ShedPool | null = null;
  now = 0;

  constructor(private out: Instances, private st: DecoStyle) {}

  put(x: number, y: number, angle: number, size: number, shape: Shape | number, col: [number, number, number],
      flex: number, h: number, glowMul = 1) {
    const st = this.st;
    let a = st.alpha * this.nodeAlpha;
    if (st.fall > 0) {
      const d = st.fall * st.fall * (0.5 + 0.9 * h) * 1.2;
      x += st.downX * d;
      y += st.downY * d;
      angle += st.fall * (h - 0.5) * 8;
      a *= 1 - st.fall;
    }
    if (this.drop) {
      if (size > 0 && a > 0.01) this.drop.add(this.now, x, y, angle, size, shape, col, flex, h, glowMul, this.frame, this.nodeAlpha);
      this.drop = null;
      return;
    }
    if (a <= 0.01 || size <= 0) return;
    const f = this.frame;
    if (f) this.out.sprite(x, y, angle, size, shape, flex, h, col[0], col[1], col[2], a, st.glow * glowMul, st.layer, f[0], f[1], f[2], f[3], f[4]);
    else this.out.sprite(x, y, angle, size, shape, flex, h, col[0], col[1], col[2], a, st.glow * glowMul, st.layer);
  }
}

/** Optional per-node extras for decorateTree. */
export interface TreeExtras {
  /** Stable ids (for vines rebuilt every frame). */
  ids?: ArrayLike<number>;
  /** Opacity (withering, the halo's fading tail). */
  alpha?: ArrayLike<number>;
  /** Take plants: blue-noise leaf ranks. A node carries a leaf when rank <= density, so leaves keep
   *  a guaranteed spacing at any density and never pile up (docs/fable-consult-2.md, R2). */
  rank?: ArrayLike<number>;
  /** Per-node brightness (dim inside, bright rim; R4). */
  tone?: ArrayLike<number>;
  /** Where to put dim, larger under-leaves drawn beneath the branches (R6). */
  under?: Instances;
  /** Take plants: per-node leaf presence 0..1, eased each frame (leaves fade and grow in and out
   *  instead of popping), and the seconds since the last frame. */
  leafState?: Float32Array;
  dt?: number;
  /** Halo vine: per-node leaf amount 0..1 (leaves fade in behind the growing tip). */
  leafGrow?: ArrayLike<number>;
  /** Take plants: per-node branch id and per-branch "has finished growing" (leaves only then). */
  branchId?: ArrayLike<number>;
  branchDone?: ArrayLike<number>;
  /** Motion: per-node branch order and bend frames (4 floats per node). */
  order?: ArrayLike<number>;
  bend?: ArrayLike<number>;
  /** growth.shed: the plant's pool of falling decorations, and the sim time. */
  shed?: ShedPool;
  now?: number;
  /** Take plants: per-node blossom open amount shown (> 0), or -1 after its petals fell. */
  bloomState?: Float32Array;
  /** A twig of this tree is withering back this frame. */
  retracting?: boolean;
  /** An old bough drying out (0..1): its leaves let go one by one, blossoms stay closed. */
  dry?: number;
}

export function decorateTree(sk: Skeleton, vis: Float32Array, p: Params, st: DecoStyle, out: Instances, extras: TreeExtras = {}) {
  const L = p.look;
  if (st.theme === 'branches' || st.density <= 0) return;
  const custom = customDef(st.theme);
  if (custom && !custom.parts.length) return;
  const place = new Placer(out, st);
  const underPlace = extras.under ? new Placer(extras.under, { ...st, glow: 0 }) : null;
  place.now = extras.now ?? 0;
  if (underPlace) underPlace.now = place.now;
  const unit = Math.max(1e-3, st.unit);
  const size = (L.decoSize * (st.sizeMul ?? 1)) / unit;
  const dens = st.density;
  const variety = clamp(L.variety);
  const rank = extras.rank;
  const shedOn = p.growth.shed && !!extras.shed && st.fall <= 0;
  // Blossom sites: twig ends chosen by hash; they carry no leaf, nor does the node before them,
  // so a flower never sits on a leaf (consult 6, 5.2).
  if (bloomSite.length < sk.n) bloomSite = new Uint8Array(sk.n * 2);
  bloomSite.fill(0, 0, sk.n);
  const tipPart = custom?.parts.find((x) => x.place === 'tips');
  const siteChance = custom ? (tipPart ? 0.35 * L.blossoms * Math.max(0, tipPart.amount) : 0) : st.theme === 'leaves' ? 0.35 * L.blossoms : 0;
  if (siteChance > 0)
    for (let i = 1; i < sk.n; i++) {
      if (sk.children[i] !== 0) continue;
      const id = extras.ids ? extras.ids[i] : i;
      if (hash1(id * 9.77 + st.seed * 4.4) >= siteChance) continue;
      bloomSite[i] = 1;
      if (!bloomSite[sk.parent[i]]) bloomSite[sk.parent[i]] = 2;
    }
  const up = Math.atan2(-st.downY, -st.downX); // the sky, in the layer's frame
  const bs = extras.bloomState;
  /** Open amount of the blossom at node i (0..1); drops its petals when shedding. */
  const blossomOpen = (i: number, want: number, h3: number, drop: () => void) => {
    if (!bs) return want;
    let b = bs[i];
    if (b < 0) {
      if (st.bloom < 0.02) b = 0; // petals fell: wait for the bloom to close before a new flower
    } else if (want >= b) b = want; // opening follows the bloom
    else if (!shedOn || b <= 0.3) b = want; // old behaviour, and half-open ones just close
    else if (want < b * (0.35 + 0.6 * h3)) {
      drop(); // each lets go at its own moment of the close
      b = -1;
    } // between: held at the size it reached
    bs[i] = b;
    return b < 0 ? 0 : b;
  };
  // Take plants: which nodes are visible tips right now (no child drawn): growing and withered
  // ends always carry a leaf, so a tree never shows bare stubs.
  if (rank) {
    if (tipScratch.length < sk.n) tipScratch = new Uint8Array(sk.n * 2);
    tipScratch.fill(1, 0, sk.n);
    for (let i = 1; i < sk.n; i++) if (vis[i] > 0.05) tipScratch[sk.parent[i]] = 0;
    // Buds: where a side shoot has withered back to its limb (or has not grown yet), the limb
    // keeps a leaf at the joint.
    const ord = extras.order;
    if (ord)
      for (let i = 1; i < sk.n; i++) {
        const pa = sk.parent[i];
        if (vis[i] <= 0.05 && ord[i] >= 2 && ord[pa] < 2 && vis[pa] > 0.6) tipScratch[pa] = 2;
      }
  }

  const frame: [number, number, number, number, number] = [1, 0, 0, 0, 0];
  const ls = extras.leafState;
  const dtL = extras.dt ?? 0;
  const ease = dtL > 0 ? 1 - Math.exp(-dtL / 0.2) : 1;
  /** Ease node i's leaf presence toward `want`; returns its size factor (0 = gone). */
  const presence = (i: number, want: boolean) => {
    if (!ls) return want ? 1 : 0;
    if (shedOn && !want && ls[i] > 0.5) {
      // Let go at full size: the pool draws it falling from now on.
      ls[i] = 0;
      place.drop = extras.shed!;
      if (underPlace) underPlace.drop = extras.shed!;
      return 1;
    }
    ls[i] += ((want ? 1 : 0) - ls[i]) * ease;
    const v = ls[i];
    return v < 0.003 ? 0 : v * v * (3 - 2 * v);
  };
  /** A blossom on its own twig end, turned toward the sky; a bud while closed. */
  const blossom = (i: number, x: number, y: number, dir: number, flex: number, h2: number, h3: number, pop: number) => {
    const ang = dir + clamp(wrapPi(up - dir), -0.9, 0.9) * 0.6 + (h2 - 0.5) * 0.5;
    const base = size * 0.075 * pop * (0.8 + 0.4 * h2);
    const c = col(st.accent, PETAL, flex * st.sScale, h3, 1, st.intensity * 1.1);
    const pc: [number, number, number] = [c[0], c[1], c[2]];
    const open = blossomOpen(i, (extras.dry ?? 0) > 0 ? 0 : st.bloom, h3, () => {
      place.drop = extras.shed!;
      place.put(x, y, ang, base * Math.max(0.02, bs ? bs[i] : 1), Shape.Blossom, pc, flex, h3, 1.4);
    });
    const shown = Math.max(open, L.buds);
    if (shown <= 0.003) return;
    if (open < L.buds) {
      // A closed bud is greener: half way to the leaf colour here.
      const lc = col(st.leaf, LEAF, flex * st.sScale, h3, 1, st.intensity);
      pc[0] = lerp(pc[0], lc[0], 0.5);
      pc[1] = lerp(pc[1], lc[1], 0.5);
      pc[2] = lerp(pc[2], lc[2], 0.5);
    }
    place.put(x, y, ang, base * shown, Shape.Blossom, pc, flex, h3, lerp(0.6, 1.4, open));
  };
  const leafOnly = !!rank && (st.theme === 'leaves' || st.theme === 'thorns') && !custom;
  for (let i = 1; i < sk.n; i++) {
    const f = vis[i];
    if (f <= 0.02) continue;
    // Take plants: most nodes carry nothing; skip them before any per-node work.
    if (leafOnly && rank![i] > Math.min(1, dens * 1.3) && tipScratch[i] === 0 && !(ls && ls[i] > 0.003)) continue;
    place.nodeAlpha = extras.alpha ? extras.alpha[i] : 1;
    if (place.nodeAlpha <= 0.01) continue;
    const id = extras.ids ? extras.ids[i] : i;
    if (extras.bend && extras.order) {
      const b = extras.bend, o = i * 4;
      frame[0] = extras.order[i];
      frame[1] = b[o];
      frame[2] = b[o + 1];
      frame[3] = b[o + 2];
      frame[4] = b[o + 3];
      place.frame = frame;
      if (underPlace) underPlace.frame = frame;
    }
    const pa = sk.parent[i];
    const dx = sk.x[i] - sk.x[pa], dy = sk.y[i] - sk.y[pa];
    const dir = Math.atan2(dy, dx);
    const terminal = sk.children[i] === 0;
    const h0 = hash1(id * 1.37 + st.seed * 7.1);
    const h1 = hash1(id * 2.71 + st.seed * 3.3);
    const h2 = hash1(id * 5.13 + st.seed * 1.9);
    const h3 = hash1(id * 9.77 + st.seed * 4.4);
    const lg = extras.leafGrow ? extras.leafGrow[i] : 1;
    if (lg <= 0.003) continue;
    const pop = (rank ? unfurl(clamp(f)) : easeOutBack(clamp(f))) * lg;
    const x = sk.x[i], y = sk.y[i], flex = sk.flex[i];
    const side = h1 < 0.5 ? -1 : 1;
    const tone = extras.tone ? extras.tone[i] : 1;

    if (custom) {
      // A user theme: its parts, placed by the same rules as the built-in themes.
      const bId = extras.branchId, bDone = extras.branchDone;
      const allowed = !rank || (f >= 0.999 && (!bId || !bDone || bDone[bId[i]] === 1));
      const visTip = !!rank && allowed && (tipScratch[i] === 2 || (tipScratch[i] === 1 && (terminal || !extras.retracting)));
      let spacedDone = false;
      for (const part of custom.parts) {
        const sid = shapeId(custom.id, part.shape);
        if (sid < 0) continue;
        const ink = part.role === 'accent' ? st.accent : st.leaf;
        const own = part.colour === 'own';
        const gl = part.glow ?? 1;
        const eff = part.sizeFrom === 'effort' ? 0.6 + L.thornEffort * st.effort : 1;
        const amt = Math.max(0, part.amount);
        const colourFor = (s: number, h: number, natScale: number, gain: number) =>
          own ? ((tintA[0] = tintA[1] = tintA[2] = gain), tintA) : col(ink, natAt(part, st, s, h), s, h, natScale, gain);
        switch (part.place) {
          case 'spaced': {
            const has = !bloomSite[i] && (rank ? allowed && (rank[i] <= Math.min(1, dens * amt) || (visTip && dens > 0.1)) : h0 < dens * 0.45 * amt || (terminal && dens > 0.15));
            const pres = rank && !spacedDone ? presence(i, has) : has ? 1 : 0;
            spacedDone = true;
            if (pres <= 0) break;
            const ang = terminal ? dir + (h1 - 0.5) * 0.6 : dir + side * lerp(0.95, 0.5 + 0.8 * h2, variety);
            const sz = size * 0.055 * part.size * eff * lerp(1, 0.6 + 0.65 * h2, variety) * pop * pres;
            place.put(x, y, ang, sz, sid, colourFor(flex * st.sScale, h2, lerp(1, 0.4 + 1.2 * h2, variety), st.intensity * tone), flex, h0, gl);
            break;
          }
          case 'tips': {
            if (bloomSite[i] !== 1 || !allowed) break;
            const ang = dir + clamp(wrapPi(up - dir), -0.9, 0.9) * 0.6 + (h2 - 0.5) * 0.5;
            const base = size * 0.075 * part.size * eff * pop * (0.8 + 0.4 * h2);
            const c = colourFor(flex * st.sScale, h3, 1, st.intensity * 1.1);
            const blooms = part.opens === 'bloom';
            const open = blooms
              ? blossomOpen(i, st.bloom, h3, () => {
                place.drop = extras.shed!;
                place.put(x, y, ang, base * Math.max(0.02, bs ? bs[i] : 1), sid, c, flex, h3, gl);
              })
              : 1;
            const s = base * (blooms ? Math.max(open, L.buds) : 1);
            if (s > 0) place.put(x, y, ang, s, sid, c, flex, h3, gl * (blooms ? lerp(0.6, 1, open) : 1));
            break;
          }
          case 'every': {
            if (rank && (!allowed || rank[i] > 1.5)) break;
            const n = 1 + Math.floor(dens * 3 * amt);
            for (let k = 0; k < n; k++) {
              const hk = hash1(id * 3.1 + k * 17.3 + st.seed);
              const s2 = k % 2 ? 1 : -1;
              place.put(x, y, dir + s2 * (0.45 + 0.9 * hk), size * 0.05 * part.size * eff * (0.8 + 0.4 * hk) * pop, sid,
                colourFor(flex * st.sScale, hk, 1, st.intensity), flex, hk, gl);
            }
            break;
          }
          case 'clusters': {
            if (rank && (!allowed || rank[i] > 1.5)) break;
            if (h2 >= (0.04 + 0.1 * dens) * amt) break;
            for (let k = 0; k < 3; k++) {
              const a = (k / 3) * Math.PI * 2 + h3 * 6;
              place.put(x + (Math.cos(a) * 0.014) / unit, y + (Math.sin(a) * 0.014) / unit, a, size * 0.03 * part.size * eff * pop, sid,
                colourFor(flex * st.sScale, h3, 1, st.intensity), flex, h3, gl);
            }
            break;
          }
          case 'pairs': {
            if (rank && (!allowed || rank[i] > 1.5)) break;
            if (h3 >= (0.05 + 0.08 * dens) * amt) break;
            for (const s2 of [-1, 1])
              place.put(x, y, dir + s2 * 0.8, size * 0.07 * part.size * eff * pop, sid, colourFor(flex * st.sScale, h1, 1, st.intensity), flex, h1, gl);
            break;
          }
        }
      }
      continue;
    }

    if (rank) {
      // Take plants: spaced leaves, with size and tint variety and a dim under-layer. Leaves sit
      // at the visible end of a growing or withering twig.
      // Only on branches that have finished growing, and only where the twig is fully there: no
      // leaves riding along a growing tip. A finished branch that withers back keeps the leaves on
      // what is left (and buds where its shoots were).
      const bId = extras.branchId, bDone = extras.branchDone;
      const allowed = f >= 0.999 && (!bId || !bDone || bDone[bId[i]] === 1);
      const visTip = allowed && (tipScratch[i] === 2 || (tipScratch[i] === 1 && (terminal || !extras.retracting)));
      const has = allowed && !bloomSite[i] && (rank[i] <= dens || (visTip && dens > 0.1)) && !((extras.dry ?? 0) > 0.1 + 0.5 * h0);
      const pxv = x, pyv = y;
      if (st.theme === 'leaves') {
        const pres = presence(i, has);
        if (pres > 0) {
          const x = pxv, y = pyv;
          const ang = terminal ? dir + (h1 - 0.5) * 0.6 : dir + side * lerp(0.95, 0.5 + 0.8 * h2, variety);
          // Inner leaves (dim tone) come out a little smaller.
          const sz = size * 0.055 * lerp(1, 0.6 + 0.65 * h2, variety) * lerp(0.85, 1.1, clamp((tone - 0.6) / 0.48)) * pop * pres;
          const inten = st.intensity * tone * lerp(1, 0.72 + 0.43 * h3, variety);
          const c = inkAt(st.leaf, flex * st.sScale, h2, tintA, LEAF, lerp(1, 0.4 + 1.2 * h2, variety), inten) as [number, number, number];
          const toUnder = underPlace && hash1(id * 7.7 + st.seed) < 0.4;
          if (toUnder) {
            tintB[0] = c[0] * 0.6;
            tintB[1] = c[1] * 0.6;
            tintB[2] = c[2] * 0.6;
            underPlace!.put(x, y, ang, sz * 1.15, Shape.Leaf, tintB, flex, h0);
          } else place.put(x, y, ang, sz, Shape.Leaf, c, flex, h0);
        }
        if (bloomSite[i] === 1 && allowed) blossom(i, pxv, pyv, dir, flex, h2, h3, pop);
        continue;
      }
      if (st.theme === 'thorns') {
        const pres = presence(i, allowed && !terminal && rank[i] <= Math.min(1, dens * 1.3));
        if (pres > 0) {
          const ang = dir + side * (0.95 + 0.25 * h2);
          const s = size * 0.034 * (0.6 + L.thornEffort * st.effort) * pop * pres * (0.7 + 0.6 * h1);
          place.put(x, y, ang, s, Shape.Thorn, col(st.leaf, THORN, flex * st.sScale, h0, 0.6, st.intensity * tone), flex, h0);
        }
        continue;
      }
      // Wreath: needles everywhere (they are thin), berries and holly on the spaced nodes.
      if (rank[i] > 1.5 || !allowed) continue; // the moat, the hidden part and growing twigs stay bare
    }

    switch (st.theme) {
      case 'leaves': {
        if (!bloomSite[i] && (h0 < dens * 0.45 || (terminal && dens > 0.15))) {
          const ang = terminal ? dir + (h1 - 0.5) * 0.6 : dir + side * (0.75 + 0.4 * h2);
          place.put(x, y, ang, size * 0.055 * (0.7 + 0.6 * h2) * pop, Shape.Leaf, col(st.leaf, LEAF, flex * st.sScale, h2, 1, st.intensity), flex, h0);
        }
        if (bloomSite[i] === 1) blossom(i, x, y, dir, flex, h2, h3, pop);
        break;
      }
      case 'thorns': {
        if (!terminal && h0 < dens * 0.6) {
          const ang = dir + side * (0.95 + 0.25 * h2);
          const s = size * 0.034 * (0.6 + L.thornEffort * st.effort) * pop * (0.7 + 0.6 * h1);
          place.put(x, y, ang, s, Shape.Thorn, col(st.leaf, THORN, flex * st.sScale, h0, 0.6, st.intensity), flex, h0);
        }
        break;
      }
      case 'wreath': {
        const needles = 1 + Math.floor(dens * 3);
        for (let k = 0; k < needles; k++) {
          const hk = hash1(id * 3.1 + k * 17.3 + st.seed);
          const s2 = k % 2 ? 1 : -1;
          place.put(x, y, dir + s2 * (0.45 + 0.9 * hk), size * 0.05 * (0.8 + 0.4 * hk) * pop, Shape.Needle,
            col(st.leaf, PINE, flex * st.sScale, hk, 1, st.intensity), flex, hk, 0.5);
        }
        if (h2 < 0.04 + 0.1 * dens) {
          for (let k = 0; k < 3; k++) {
            const a = (k / 3) * Math.PI * 2 + h3 * 6;
            const ox = Math.cos(a) * 0.014 / unit, oy = Math.sin(a) * 0.014 / unit;
            place.put(x + ox, y + oy, a, size * 0.03 * pop, Shape.Berry, col(st.accent, BERRY, flex * st.sScale, h3, 1, st.intensity), flex, h3, 1.3);
          }
        }
        if (h3 < 0.05 + 0.08 * dens) {
          for (const s2 of [-1, 1])
            place.put(x, y, dir + s2 * 0.8, size * 0.07 * pop, Shape.Holly, col(st.leaf, HOLLY, flex * st.sScale, h1, 1, st.intensity), flex, h1);
        }
        break;
      }
    }
  }
  extras.shed?.draw(out, st, extras.now ?? 0, dryOf(p));
}

/**
 * Decorations on the halo ring itself (unit circle). `revealAt(angle)` gives 0..1 for how far
 * the halo reveal has reached that point.
 */
/**
 * `revealAt(angle)` gives 0..1 for how much the vine covers that point; a share `always` of the
 * ring's decorations, spread evenly, is shown regardless.
 */
export function decorateRing(p: Params, st: DecoStyle, revealAt: (angle: number) => number, out: Instances, always = 0) {
  const L = p.look;
  if (st.theme === 'branches' || st.density <= 0) return;
  const custom = customDef(st.theme);
  const ringPart = custom?.parts.find((x) => x.place === 'spaced' || x.place === 'every');
  if (custom && !ringPart) return;
  const place = new Placer(out, st);
  const unit = Math.max(1e-3, st.unit);
  const size = (L.decoSize * (st.sizeMul ?? 1)) / unit;
  const dens = st.density;
  const spacing = st.theme === 'wreath' ? 0.07 : st.theme === 'thorns' ? 0.2 : 0.3;

  let k = 0;
  for (let a = 0; a < Math.PI * 2; a += spacing, k++) {
    const h0 = hash1(k * 1.91 + st.seed * 2.3);
    const h1 = hash1(k * 4.37 + st.seed * 5.9);
    // Evenly spaced always-there share: every point where floor(k * always) steps up.
    const isAlways = always > 0 && Math.floor((k + 1) * always) > Math.floor(k * always);
    const v = isAlways ? 1 : revealAt(a);
    place.nodeAlpha = 1;
    if (v <= 0.02) continue;
    const pop = easeOutBack(clamp(v));
    const x = Math.cos(a), y = Math.sin(a);
    const tangent = a + Math.PI / 2;
    const alt = k % 2 ? 1 : -1;
    if (custom && ringPart) {
      const sid = shapeId(custom.id, ringPart.shape);
      if (sid >= 0 && h0 < dens * 0.8 * ringPart.amount) {
        const own = ringPart.colour === 'own';
        const c = own ? ((tintA[0] = tintA[1] = tintA[2] = st.intensity), tintA)
          : col(ringPart.role === 'accent' ? st.accent : st.leaf, natAt(ringPart, st, a / TAU2, h0), a / TAU2, h0, 1, st.intensity);
        place.put(x, y, a + (alt > 0 ? 0 : Math.PI) + alt * (0.7 + 0.4 * h1), size * 0.045 * ringPart.size * pop * (0.7 + 0.6 * h1),
          sid, c, 0, h0, ringPart.glow ?? 1);
      }
      continue;
    }
    switch (st.theme) {
      case 'leaves':
        if (h0 < dens * 0.8)
          place.put(x, y, a + (alt > 0 ? 0 : Math.PI) + alt * (0.7 + 0.4 * h1), size * 0.045 * pop * (0.7 + 0.6 * h1),
            Shape.Leaf, col(st.leaf, LEAF, a / TAU2, h0, 1, st.intensity), 0, h0);
        break;
      case 'thorns':
        if (h0 < dens)
          place.put(x, y, a + (alt > 0 ? 0 : Math.PI) + (h1 - 0.5) * 0.6,
            size * 0.03 * (0.6 + L.thornEffort * st.effort) * pop, Shape.Thorn, col(st.leaf, THORN, a / TAU2, h0, 0.6, st.intensity), 0, h0);
        break;
      case 'wreath':
        for (const s2 of [-1, 1])
          place.put(x, y, tangent + (s2 > 0 ? 0 : Math.PI) + s2 * (0.35 + 0.6 * h1) * alt, size * 0.055 * pop * (0.8 + 0.4 * h0),
            Shape.Needle, col(st.leaf, PINE, a / TAU2, h1, 1, st.intensity), 0, h1, 0.5);
        if (k % 12 === 0 && h0 < 0.4 + 0.6 * dens)
          for (let b = 0; b < 3; b++) {
            const ba = (b / 3) * Math.PI * 2 + h1 * 6;
            place.put(x + (Math.cos(ba) * 0.015) / unit, y + (Math.sin(ba) * 0.015) / unit, ba, size * 0.032 * pop,
              Shape.Berry, col(st.accent, BERRY, a / TAU2, h0, 1, st.intensity), 0, h0, 1.3);
          }
        if (k % 18 === 6)
          for (const s2 of [-1, 1])
            place.put(x, y, tangent + s2 * 0.9 + (s2 > 0 ? 0 : Math.PI), size * 0.075 * pop, Shape.Holly,
              col(st.leaf, HOLLY, a / TAU2, h1, 1, st.intensity), 0, h1);
        break;
    }
  }
}
