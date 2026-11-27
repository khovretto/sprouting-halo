// Decorations (themes): leaves + blossoms, thorns, or a Christmas wreath (pine needles, berries,
// holly). Placed deterministically on branch nodes (a hash of the node index, so they don't
// flicker), sized by how revealed that node is, and dropped with a fall animation when pruned.
// Shapes are drawn in shaders/sprite.frag.

import type { Params } from './params';
import type { Theme } from './features';
import type { Instances } from './render/renderer';
import type { Skeleton } from './growth/skeleton';
import { clamp, fallDir, hash1, lerp, RGB } from './math';
import { Ink, inkAt, inkPt } from './colour';
import { customDef, MOVES, pivotOf, shapeId, SHAPE_PIVOT, ThemeDef, ThemePart } from './themes';
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
/** Leaves on a growing branch come in this far (plant units) behind its growing tip. */
const LEAF_BEHIND = 0.12;
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
  /** glow.travel: the glow at a point (s 0 root .. 1 tip; x, y in the layer), instead of `glow`. */
  glowAlong?: (s: number, x: number, y: number) => number;
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
  /** growth.fallDirection "away": what lets go drifts straight out from (originX, originY). */
  fallAway?: boolean;
  /** How leaves and petals that let go fall (params.falling). */
  drop?: { speed: number; sway: number; spin: number; flutter: number; time: number };
  originX?: number;
  originY?: number;
  intensity: number;
  /** Sim time and the voice's pitch 0..1 (a theme's moving natural gradient). */
  time?: number;
  pitch?: number;
  /** 0..1 in harmony with another track (theme parts that open "in harmony"). */
  harmony?: number;
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
  /** Set for every put() at the current node (a halo node whose leaves all let go). */
  dropNode: ShedPool | null = null;
  now = 0;
  /** Origin of the shapes put now (a user theme's part); null = the built-in shape's own. */
  pivot: readonly [number, number] | null = null;

  constructor(private out: Instances, private st: DecoStyle) {}

  put(x: number, y: number, angle: number, size: number, shape: Shape | number, col: [number, number, number],
      flex: number, h: number, glowMul = 1) {
    const st = this.st;
    let a = st.alpha * this.nodeAlpha;
    if (st.fall > 0) {
      const d = st.fall * st.fall * (0.5 + 0.9 * h) * (st.fallAway ? 0.8 : 1.2);
      const [Dx, Dy] = fallDir(st.downX, st.downY, !!st.fallAway, x, y, st.originX, st.originY);
      x += Dx * d;
      y += Dy * d;
      angle += st.fall * (h - 0.5) * 8;
      a *= 1 - st.fall;
    }
    const pv = this.pivot ?? (shape < 16 ? SHAPE_PIVOT[shape] ?? SHAPE_PIVOT[0] : SHAPE_PIVOT[0]);
    const pivY = pv[1], pivX = pv[0] - 0.5;
    const pool = this.drop ?? this.dropNode;
    if (pool) {
      if (size > 0 && a > 0.01) pool.add(this.now, x, y, angle, size, shape, col, flex, h, glowMul, this.frame, this.nodeAlpha, pivY, pivX, this.st);
      this.drop = null;
      return;
    }
    if (a <= 0.01 || size <= 0) return;
    const f = this.frame;
    const g = (st.glowAlong ? st.glowAlong(flex * st.sScale, x, y) : st.glow) * glowMul;
    if (f) this.out.sprite(x, y, angle, size, shape, flex, h, col[0], col[1], col[2], a, g, st.layer, f[0], f[1], f[2], f[3], f[4], pivY, pivX);
    else this.out.sprite(x, y, angle, size, shape, flex, h, col[0], col[1], col[2], a, g, st.layer, 1, x, y, flex, 0, pivY, pivX);
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
  /** Per branch: the flex its growing tip has reached; leaves come in LEAF_BEHIND behind it. */
  branchFront?: ArrayLike<number>;
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
  /** look.leafFall: per node, > 0 while its leaf has fallen and not grown back. */
  leafGone?: ArrayLike<number>;
  /** Per node: 1 = its branch piece just broke off and fell (growth "fall away"): its leaf falls
   *  too. Cleared here. */
  dropped?: Uint8Array;
  /** Only the nodes of this part (one half of a mirrored bough, drawn in its own layer): part[i]. */
  only?: { part: Int8Array; k: number };
  /** Halo vine (growth.shed): ids of nodes whose leaves have let go; a node's leaves let go once
   *  letGoAlpha (its tail fade) times letGoAll (the whole halo's fade) falls below one half. */
  letGone?: Set<number>;
  letGoAlpha?: ArrayLike<number>;
  letGoAll?: number;
  /** Per node: 0 = another pass lets this node's leaves go (a look change: two looks share a vine). */
  letGoMine?: ArrayLike<number>;
  /** The pool is drawn by the caller (a halo: its passes share it). */
  shedDrawnElsewhere?: boolean;
}

export function decorateTree(sk: Skeleton, vis: Float32Array, p: Params, st: DecoStyle, out: Instances, extras: TreeExtras = {}) {
  const L = p.look;
  if (st.theme === 'branches' || st.density <= 0) return;
  const custom = customDef(st.theme);
  if (custom && !custom.parts.length) return;
  // Spaced parts share the leaf slots (consult 8, 1.3): the first takes ranks up to its cut, each
  // further one the next window, so leaves and thorns never sit on the same node.
  const spaced = custom ? custom.parts.filter((x) => x.place === 'spaced') : [];
  const cuts: number[] = [];
  for (let k = 0, acc = 0; k < spaced.length; k++) cuts.push(Math.min(1, (acc += st.density * Math.max(0, spaced[k].amount))));
  const sparse = !!custom && custom.parts.every((x) => x.place === 'spaced' || x.place === 'tips');
  const place = new Placer(out, st);
  const underPlace = extras.under ? new Placer(extras.under, { ...st, glow: 0, glowAlong: undefined }) : null;
  place.now = extras.now ?? 0;
  if (underPlace) underPlace.now = place.now;
  const unit = Math.max(1e-3, st.unit);
  const size = (L.decoSize * (st.sizeMul ?? 1)) / unit;
  const dens = st.density;
  const variety = clamp(L.variety);
  const rank = extras.rank;
  const canShed = !!extras.shed && st.fall <= 0;
  // growth.shed: leaves let go when their twig goes. Off: they go the way of the twig.
  const shedOn = p.growth.shed && canShed;
  // In harmony, 0..1 eased (theme parts with opens: 'harmony').
  const hmRaw = clamp(st.harmony ?? 0), hm = hmRaw * hmRaw * (3 - 2 * hmRaw);
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
      if (want < 0.02) b = 0; // petals fell: wait for the bloom to close before a new flower
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
  /** Ease node i's leaf presence toward `want`; returns its size factor (0 = gone). `falls`: it
   *  lets go and falls whatever growth.shed says (it fell on its own, or its twig fell). */
  const presence = (i: number, want: boolean, falls = false) => {
    if (!ls) return want ? 1 : 0;
    if ((shedOn || (falls && canShed)) && !want && ls[i] > 0.5) {
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
  const gone = extras.leafGone;
  const dropped = extras.dropped;
  const leafOnly = !!rank && (st.theme === 'leaves' || st.theme === 'thorns') && !custom;
  const only = extras.only;
  for (let i = 1; i < sk.n; i++) {
    if (only && only.part[i] !== only.k) continue;
    let f = vis[i];
    // Its branch piece just fell: the leaf is drawn once more, to let go at full size.
    const letGo = !!dropped && dropped[i] === 1;
    if (letGo) {
      dropped![i] = 0;
      f = 1;
    }
    if (f <= 0.02) continue;
    // A leaf that falls whatever growth.shed says: it fell on its own (look.leafFall) or with its twig.
    const falls = letGo || !!(gone && gone[i] > 0);
    // growth.shed: a leaf lets go of a fading twig once the twig is half gone.
    const faded = shedOn && !!extras.alpha && extras.alpha[i] < 0.55;
    // Take plants: most nodes carry nothing; skip them before any per-node work.
    if (leafOnly && rank![i] > Math.min(1, dens * 1.3) && tipScratch[i] === 0 && !(ls && ls[i] > 0.003)) continue;
    if (sparse && rank && rank[i] > 1 && tipScratch[i] === 0 && bloomSite[i] !== 1 && !(ls && ls[i] > 0.003)) continue;
    place.nodeAlpha = extras.alpha ? extras.alpha[i] : 1;
    place.dropNode = null;
    const id = extras.ids ? extras.ids[i] : i;
    if (extras.letGone) {
      // Halo vine: its leaves let go once its tail (or the whole halo) has faded half way, and grow
      // back once it shows fully again (a look change brought it back), or shedding is off.
      const la = (extras.letGoAlpha ? extras.letGoAlpha[i] : place.nodeAlpha) * (extras.letGoAll ?? 1);
      if (extras.letGone.has(id)) {
        if (la > 0.85 || !shedOn) extras.letGone.delete(id);
        else continue;
      } else if (shedOn && la < 0.5) {
        // Two looks share this node (a look change): the other pass lets it go, with all of la, this
        // frame; not drawn here too.
        if (extras.letGoMine && !(extras.letGoMine[i] > 0)) continue;
        extras.letGone.add(id);
        place.dropNode = extras.shed!;
        // It falls at the opacity it had (the pool is drawn without the halo's fade). Two passes
        // sharing a node (letGoMine) show la between them; otherwise what this pass showed (a
        // node a look change still hides lets go unseen).
        place.nodeAlpha = extras.letGoMine ? la : Math.min(la, place.nodeAlpha * (extras.letGoAll ?? 1));
      }
    }
    if (place.nodeAlpha <= 0.01) continue;
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
    inkPt.x = x;
    inkPt.y = y;
    const side = h1 < 0.5 ? -1 : 1;
    const tone = extras.tone ? extras.tone[i] : 1;

    if (custom) {
      // A user theme: its parts, placed by the same rules as the built-in themes.
      const bId = extras.branchId, bDone = extras.branchDone, bFront = extras.branchFront;
      const allowed = !rank || (!letGo && f >= 0.999 && (!bId || !bDone || bDone[bId[i]] === 1 || (!!bFront && bFront[bId[i]] - flex >= LEAF_BEHIND)));
      const visTip = !!rank && allowed && (tipScratch[i] === 2 || (tipScratch[i] === 1 && (terminal || !extras.retracting)));
      // Which spaced part owns this node (-1: none), and whether it is there now (one presence per node).
      let owner = -1, pres = 0;
      if (spaced.length) {
        const key = rank ? rank[i] : h0 / 0.45; // rank 2 = never a slot
        for (let k = 0; k < cuts.length; k++)
          if (key <= cuts[k]) {
            owner = k;
            break;
          }
        if (rank) {
          const tip = visTip && dens > 0.1;
          // True twig ends, bare visible ends and leaves still fading out belong to the first part.
          if ((tip && (terminal || owner < 0)) || (owner < 0 && ls && ls[i] > 0.003)) owner = 0;
          const has = owner >= 0 && allowed && !faded && !bloomSite[i] && !(gone && gone[i] > 0) && (key <= cuts[cuts.length - 1] || tip)
            && !((extras.dry ?? 0) > 0.1 + 0.5 * h0);
          pres = owner >= 0 ? presence(i, has, falls) : 0;
        } else {
          if (owner < 0 && terminal && dens > 0.15) owner = 0;
          pres = owner >= 0 && !bloomSite[i] ? 1 : 0;
        }
      }
      for (const part of custom.parts) {
        const sid = shapeId(custom.id, part.shape);
        if (sid < 0) continue;
        place.pivot = pivotOf(part);
        const ink = part.role === 'accent' ? st.accent : st.leaf;
        const own = part.colour === 'own';
        const gl = part.glow ?? 1;
        const inHarmony = part.opens === 'harmony';
        // A part that opens in harmony is not there otherwise (twig-end parts close to a bud, below).
        if (inHarmony && part.place !== 'tips' && hm <= 0.01) continue;
        const eff = (part.sizeFrom === 'effort' ? 0.6 + L.thornEffort * st.effort : 1) * (inHarmony && part.place !== 'tips' ? hm : 1);
        const amt = Math.max(0, part.amount);
        const colourFor = (s: number, h: number, natScale: number, gain: number) =>
          own ? ((tintA[0] = tintA[1] = tintA[2] = gain), tintA) : col(ink, natAt(part, st, s, h), s, h, natScale, gain);
        switch (part.place) {
          case 'spaced': {
            void amt;
            if (spaced[owner] !== part || pres <= 0) break;
            const ang = terminal ? dir + (h1 - 0.5) * 0.6 : dir + side * lerp(0.95, 0.5 + 0.8 * h2, variety);
            const sz = size * 0.055 * part.size * eff * lerp(1, 0.6 + 0.65 * h2, variety) * pop * pres;
            place.put(x, y, ang, sz, sid, colourFor(flex * st.sScale, h2, lerp(1, 0.4 + 1.2 * h2, variety), st.intensity * tone), flex, h0, gl);
            place.drop = null; // presence() arms both placers; only this one was used
            if (underPlace) underPlace.drop = null;
            break;
          }
          case 'tips': {
            if (bloomSite[i] !== 1 || !allowed) break;
            const ang = dir + clamp(wrapPi(up - dir), -0.9, 0.9) * 0.6 + (h2 - 0.5) * 0.5;
            const base = size * 0.075 * part.size * eff * pop * (0.8 + 0.4 * h2);
            const c = colourFor(flex * st.sScale, h3, 1, st.intensity * 1.1);
            const blooms = part.opens === 'bloom' || inHarmony;
            const open = blooms
              ? blossomOpen(i, (extras.dry ?? 0) > 0 ? 0 : inHarmony ? hm : st.bloom, h3, () => {
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
              const sz = size * 0.03 * part.size * eff * pop, r = 0.014 / unit + place.pivot![1] * sz;
              place.put(x + Math.cos(a) * r, y + Math.sin(a) * r, a, sz, sid,
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
      place.pivot = null;
      continue;
    }

    if (rank) {
      // Take plants: spaced leaves, with size and tint variety and a dim under-layer. Leaves sit
      // at the visible end of a growing or withering twig.
      // Only where the twig is fully there and a little behind the growing tip (they fade in as
      // the tip moves on): no leaves riding along a growing tip. A finished branch that withers
      // back keeps the leaves on what is left (and buds where its shoots were).
      const bId = extras.branchId, bDone = extras.branchDone, bFront = extras.branchFront;
      const allowed = !letGo && f >= 0.999 && (!bId || !bDone || bDone[bId[i]] === 1 || (!!bFront && bFront[bId[i]] - flex >= LEAF_BEHIND));
      const visTip = allowed && (tipScratch[i] === 2 || (tipScratch[i] === 1 && (terminal || !extras.retracting)));
      const has = allowed && !faded && !bloomSite[i] && !(gone && gone[i] > 0) && (rank[i] <= dens || (visTip && dens > 0.1)) && !((extras.dry ?? 0) > 0.1 + 0.5 * h0);
      const pxv = x, pyv = y;
      if (st.theme === 'leaves') {
        const pres = presence(i, has, falls);
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
        const pres = presence(i, allowed && !faded && !terminal && rank[i] <= Math.min(1, dens * 1.3), letGo);
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
            // Out by half a berry too: it grows from its middle (SHAPE_PIVOT), the cluster keeps its size.
            const r = 0.014 / unit + 0.5 * size * 0.03 * pop;
            const ox = Math.cos(a) * r, oy = Math.sin(a) * r;
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
  place.dropNode = null;
  if (!extras.shedDrawnElsewhere) extras.shed?.draw(out, st, extras.now ?? 0, dryOf(p));
}

/** Draw a pool of falling leaves (a halo's: its passes share one) at opacity `alpha`. */
export function drawShed(pool: ShedPool, out: Instances, st: DecoStyle, now: number, p: Params, alpha: number) {
  pool.draw(out, { ...st, alpha }, now, dryOf(p));
}

/** A halo ring's let-go state: per ring decoration (by index round the ring, at `spacing`)
 *  whether it let go (it stays hidden until the vine covers it again) and how visible it was. */
export interface RingLetGo {
  gone: Uint8Array;
  prev: Float32Array;
  spacing: number;
}

/** Optional extras for decorateRing. */
export interface RingExtras {
  /** 0..1 per angle: how much of this look is shown there (a look change sweeping round). */
  mask?: (angle: number) => number;
  /** growth.shed: the ring's let-go state; `track`: this pass keeps it and lets leaves go into
   *  `shed` (the other pass of a look change only reads it). */
  ring?: RingLetGo;
  track?: boolean;
  shed?: ShedPool;
  /** The whole halo's fade (1 = there). */
  whole?: number;
  now?: number;
}

/**
 * Decorations on the halo ring itself (unit circle). `revealAt(angle)` gives 0..1 for how far
 * the halo reveal has reached that point.
 */
/**
 * `revealAt(angle)` gives 0..1 for how much the vine covers that point; a share `always` of the
 * ring's decorations, spread evenly, is shown regardless.
 */
export function decorateRing(p: Params, st: DecoStyle, revealAt: (angle: number) => number, out: Instances, always = 0, ex: RingExtras = {}) {
  const L = p.look;
  // Nothing on the ring: what it knew of its decorations is stale by the time it has some again.
  const none = () => {
    if (ex.ring && ex.track) ex.ring.spacing = -1;
  };
  if (st.theme === 'branches' || st.density <= 0) return none();
  const custom = customDef(st.theme);
  // Every spaced / every part, alternating round the ring (a leaf, a thorn, a leaf…).
  const ringParts = custom ? custom.parts.filter((x) => x.place === 'spaced' || x.place === 'every') : [];
  if (custom && !ringParts.length) return none();
  const nR = Math.max(1, ringParts.length);
  const place = new Placer(out, st);
  place.now = ex.now ?? 0;
  const unit = Math.max(1e-3, st.unit);
  const size = (L.decoSize * (st.sizeMul ?? 1)) / unit;
  const dens = st.density;
  const spacing = (st.theme === 'wreath' ? 0.07 : st.theme === 'thorns' ? 0.2 : 0.3) / nR;
  const R = ex.ring;
  // The state is by index round the ring: other spacing, other decorations.
  if (R && R.spacing !== spacing) {
    R.gone.fill(0);
    R.prev.fill(0);
    R.spacing = spacing;
  }
  const shedOn = p.growth.shed && !!ex.shed && !!R && !!ex.track && st.fall <= 0;

  let k = 0;
  for (let a = 0; a < Math.PI * 2; a += spacing, k++) {
    const h0 = hash1(k * 1.91 + st.seed * 2.3);
    const h1 = hash1(k * 4.37 + st.seed * 5.9);
    // Evenly spaced always-there share: every point where floor(k * always) steps up.
    const isAlways = always > 0 && Math.floor((k + 1) * always) > Math.floor(k * always);
    let v = isAlways ? 1 : revealAt(a);
    place.nodeAlpha = 1;
    place.dropNode = null;
    if (R && k < R.gone.length) {
      // growth.shed: it lets go as the vine's tail fades past it (or the whole halo fades), and
      // comes back once the vine covers it again. Not while a look change is still reaching it.
      const vl = v * (ex.whole ?? 1), pv = R.prev[k];
      const settled = !ex.mask || ex.mask(a) >= 0.999;
      if (ex.track) R.prev[k] = settled ? vl : 0;
      if (R.gone[k]) {
        if (vl > 0.85) R.gone[k] = 0;
        else continue;
      } else if (shedOn && settled && vl < 0.5 && pv >= 0.5) {
        R.gone[k] = 1;
        place.dropNode = ex.shed!;
        place.nodeAlpha = ex.whole ?? 1; // at the opacity it had (the pool is drawn without the fade)
        v = 1;
      }
    }
    if (ex.mask && !place.dropNode) v *= ex.mask(a);
    if (v <= 0.02) continue;
    const pop = easeOutBack(clamp(v));
    const x = Math.cos(a), y = Math.sin(a);
    inkPt.x = x;
    inkPt.y = y;
    const tangent = a + Math.PI / 2;
    const alt = Math.floor(k / nR) % 2 ? 1 : -1; // not k % 2: with two parts every thorn would point inward
    const ringPart = ringParts[k % nR];
    if (custom && ringPart) {
      const sid = shapeId(custom.id, ringPart.shape);
      place.pivot = pivotOf(ringPart);
      const hmR = ringPart.opens === 'harmony' ? clamp(st.harmony ?? 0) : 1;
      if (sid >= 0 && hmR > 0.01 && h0 < dens * 0.8 * ringPart.amount) {
        const own = ringPart.colour === 'own';
        const c = own ? ((tintA[0] = tintA[1] = tintA[2] = st.intensity), tintA)
          : col(ringPart.role === 'accent' ? st.accent : st.leaf, natAt(ringPart, st, a / TAU2, h0), a / TAU2, h0, 1, st.intensity);
        place.put(x, y, a + (alt > 0 ? 0 : Math.PI) + alt * (0.7 + 0.4 * h1), size * 0.045 * ringPart.size * hmR * pop * (0.7 + 0.6 * h1),
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
            const r = 0.015 / unit + 0.5 * size * 0.032 * pop;
            place.put(x + Math.cos(ba) * r, y + Math.sin(ba) * r, ba, size * 0.032 * pop,
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
