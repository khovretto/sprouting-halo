// Themes (docs/fable-consult-5-colour-themes-panel.md, C). A theme is a named set of up to 6
// decoration parts. The four built-in themes keep their own code in deco.ts; user themes run
// through one generic loop over their parts, and may use their own PNG textures.
//
// User themes live in a "themes" folder next to Sprout.exe (one JSON per theme, textures embedded),
// so the OBS page gets them too. Read: GET /theme-files/index.json and /theme-files/<id>.json;
// write: the "themeSave" / "themeDelete" WebSocket messages (local pages only).

export type Place = 'spaced' | 'every' | 'tips' | 'clusters' | 'pairs';
export type BuiltinShape = 'leaf' | 'thorn' | 'berry' | 'needle' | 'holly' | 'blossom';

export interface ThemePart {
  place: Place;
  /** A built-in shape, or `tex:<name>` for one of this theme's textures. */
  shape: string;
  /** Relative to the built-in size for that placement (1 = unchanged). */
  size: number;
  /** Weight on the track's density (1 = unchanged). */
  amount: number;
  /** Which colour role paints it. */
  role: 'leaf' | 'accent';
  /** '#rrggbb' or a gradient string (gradient.ts), used when the role's source is "theme". */
  natural: string;
  /** How a natural gradient is spread over the parts (MOVES). */
  move?: string;
  /** tint: a white / grey texture coloured by the role. own: keeps its own colours. */
  colour?: 'tint' | 'own';
  glow?: number;
  /** 0 rigid .. 1 like a leaf. */
  flutter?: number;
  /** Grows with vocal effort (look.thornEffort). */
  sizeFrom?: 'effort' | 'none';
  /** bloom: opens on long held notes like blossoms. */
  opens?: 'always' | 'bloom';
  /** Origin: the point of the shape that sits on the branch, and that it grows and turns about.
   *  x 0 (left) .. 1 (right), y 0 (bottom) .. 1 (top) of the shape drawn pointing up. Unset = the
   *  shape's own (pictures and leaves: the bottom centre, like a stalk; blossoms, berries: the middle). */
  pivot?: [number, number];
}

export interface ThemeDef {
  id: string;
  name: string;
  version: 1;
  parts: ThemePart[];
  /** name -> PNG data URL (at most 256 × 256). */
  textures?: Record<string, string>;
  /** The branches' natural colour ('#rrggbb' or a gradient), when their colour role says "Theme colour". */
  branch?: { natural: string };
}

/** Movements of a theme's natural gradient (the same five as the colour roles'). */
export const MOVES: Record<string, { along: number; speed: number; scatter: number; pitch: number }> = {
  Still: { along: 0, speed: 0, scatter: 0, pitch: 0 },
  'Root→tip': { along: 1, speed: 0, scatter: 0, pitch: 0 },
  Flow: { along: 0.3, speed: 0.05, scatter: 0, pitch: 0 },
  Sparkle: { along: 0, speed: 0, scatter: 1, pitch: 0 },
  'Sing it': { along: 0.2, speed: 0, scatter: 0, pitch: 1 },
};

/** Natural branch colours of the built-in themes (consult 6, 6.2). */
const BUILTIN_BRANCH: Record<string, string> = { leaves: '#7a5a3a', thorns: '#5a3b46', wreath: '#5b4630', branches: '#cfd8e6' };
/** The natural branch colour of a theme ('' = none: the take colour). */
export const branchNatural = (id: string) => BUILTIN_BRANCH[id] ?? themeDef(id)?.branch?.natural ?? '';

export const BUILTIN_IDS = ['leaves', 'thorns', 'wreath', 'branches'];
export const BUILTIN_THEMES: ThemeDef[] = [
  {
    id: 'leaves', name: 'Leaves', version: 1, parts: [
      { place: 'spaced', shape: 'leaf', size: 1, amount: 1, role: 'leaf', natural: '#52c757', flutter: 1 },
      { place: 'tips', shape: 'blossom', size: 1, amount: 1, role: 'accent', natural: '#ffd1e6', glow: 1.4, opens: 'bloom', flutter: 0.4, pivot: [0.5, 0.5] },
    ],
  },
  {
    id: 'thorns', name: 'Thorns', version: 1, parts: [
      { place: 'spaced', shape: 'thorn', size: 1, amount: 1, role: 'leaf', natural: '#ebdbb3', flutter: 0, sizeFrom: 'effort' },
    ],
  },
  {
    id: 'wreath', name: 'Christmas wreath', version: 1, parts: [
      { place: 'every', shape: 'needle', size: 1, amount: 1, role: 'leaf', natural: '#298c4d', glow: 0.5, flutter: 0.5 },
      { place: 'clusters', shape: 'berry', size: 1, amount: 1, role: 'accent', natural: '#e61424', glow: 1.3, flutter: 0.3, pivot: [0.5, 0.5] },
      { place: 'pairs', shape: 'holly', size: 1, amount: 1, role: 'leaf', natural: '#1a7333', flutter: 0.8 },
    ],
  },
  { id: 'branches', name: 'Branches (no decorations)', version: 1, parts: [] },
];

const SHAPE_IDS: Record<string, number> = { leaf: 0, thorn: 1, berry: 2, needle: 3, holly: 4, blossom: 5 };
/** Default origins of the built-in shapes, by shape id ([x, y] as in ThemePart.pivot). Round shapes
 *  grow from their middle, not from their edge. */
export const SHAPE_PIVOT: [number, number][] = [[0.5, 0], [0.5, 0], [0.5, 0.5], [0.5, 0], [0.5, 0], [0.5, 0.5]];
const BOTTOM: [number, number] = [0.5, 0];
/** The origin a part uses (its own, else its shape's). */
export const pivotOf = (part: ThemePart): [number, number] =>
  part.pivot ?? (part.shape.startsWith('tex:') ? BOTTOM : SHAPE_PIVOT[SHAPE_IDS[part.shape] ?? 0]);

// ---- Registry ------------------------------------------------------------------------------------

const custom = new Map<string, ThemeDef>();
/** Theme being edited on the /themes page (shown in its preview, not saved). */
let draft: ThemeDef | null = null;
let listeners: (() => void)[] = [];

export const isBuiltin = (id: string) => BUILTIN_IDS.includes(id);
export function themeDef(id: string): ThemeDef | undefined {
  if (draft && draft.id === id) return draft;
  return custom.get(id) ?? BUILTIN_THEMES.find((t) => t.id === id);
}
/** A user theme (generic part loop), or undefined for a built-in one. */
export const customDef = (id: string) => (isBuiltin(id) ? undefined : themeDef(id));
export const allThemes = (): ThemeDef[] => [...BUILTIN_THEMES, ...[...custom.values()].sort((a, b) => a.name.localeCompare(b.name))];
export function onThemesChanged(fn: () => void) {
  listeners.push(fn);
}
const changed = () => {
  void refreshTextures();
  for (const fn of listeners) fn();
};

/** The theme being edited changed. Only the textures follow: the preview reads the draft every
 *  frame, and the theme lists must not rebuild while a slider of the editor is being dragged. */
export function setDraft(def: ThemeDef | null) {
  draft = def ? JSON.parse(JSON.stringify(def)) : null;
  void refreshTextures();
}

/** Load every user theme from Sprout.exe (base = http://host:port). */
export async function loadThemes(base: string) {
  try {
    const ids = (await (await fetch(`${base}/theme-files/index.json`, { cache: 'no-store' })).json()) as string[];
    const got = await Promise.all(ids.slice(0, 64).map(async (id) => {
      try {
        const def = (await (await fetch(`${base}/theme-files/${id}.json`, { cache: 'no-store' })).json()) as ThemeDef;
        return def && Array.isArray(def.parts) ? { ...def, id } : null;
      } catch {
        return null;
      }
    }));
    custom.clear();
    for (const d of got) if (d) custom.set(d.id, d);
    changed();
  } catch {
    /* no Sprout.exe (offline page): built-in themes only */
  }
}

// ---- Textures: up to 16 layers of one texture array ------------------------------------------------

export interface TexLayer {
  layer: number;
  image: HTMLCanvasElement;
  /** Half-width of the drawn quad (0.5 × aspect, in the shape's units). */
  halfWidth: number;
  flutter: number;
  own: boolean;
}
const texLayers = new Map<string, TexLayer>(); // `${themeId}:${name}`
let texRev = 0;
export const textureRevision = () => texRev;
export const textureLayers = () => [...texLayers.values()];

const canvasCache = new Map<string, Promise<{ c: HTMLCanvasElement; aspect: number } | null>>();
/** A texture's canvas (decoded once per picture, however often the draft changes). */
function toCanvas(url: string) {
  let c = canvasCache.get(url);
  if (!c) {
    c = decodeToCanvas(url);
    canvasCache.set(url, c);
    if (canvasCache.size > 48) canvasCache.delete(canvasCache.keys().next().value!);
  }
  return c;
}

async function decodeToCanvas(url: string): Promise<{ c: HTMLCanvasElement; aspect: number } | null> {
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    return null;
  }
  // Stretched over 256 × 256 with a 2 px clear border: the quad it is drawn on has the picture's
  // own aspect (halfWidth), so it shows unstretched. (It used to be fitted bottom-centred, which
  // squashed wide pictures and thinned tall ones.)
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 2, 2, 252, 252);
  return { c, aspect: img.naturalWidth / Math.max(1, img.naturalHeight) };
}

let texJob = 0;
async function refreshTextures() {
  const job = ++texJob;
  const want: { key: string; url: string; part: ThemePart }[] = [];
  const defs = [...(draft ? [draft] : []), ...custom.values()];
  for (const d of defs)
    for (const part of d.parts)
      if (part.shape.startsWith('tex:')) {
        const name = part.shape.slice(4), url = d.textures?.[name];
        if (url && !want.some((w) => w.key === `${d.id}:${name}`)) want.push({ key: `${d.id}:${name}`, url, part });
      }
  const next = new Map<string, TexLayer>();
  for (const w of want.slice(0, 16)) {
    const t = await toCanvas(w.url);
    if (!t) continue;
    next.set(w.key, {
      layer: next.size, image: t.c, halfWidth: 0.5 * Math.min(2, Math.max(0.15, t.aspect)),
      flutter: w.part.flutter ?? 1, own: w.part.colour === 'own',
    });
  }
  if (job !== texJob) return; // a newer refresh started meanwhile: it wins
  texLayers.clear();
  for (const [k, v] of next) texLayers.set(k, v);
  texRev++;
}

/** Shape id for the sprite shader: 0..5 built-in shapes, 16 + layer for textures (-1 = missing). */
export function shapeId(themeId: string, shape: string): number {
  if (shape.startsWith('tex:')) {
    const t = texLayers.get(`${themeId}:${shape.slice(4)}`);
    return t ? 16 + t.layer : -1;
  }
  return SHAPE_IDS[shape] ?? 0;
}

/** Leaf-like flutter of a built-in shape (sprite.vert uses the same table). */
export const BUILTIN_SHAPES = Object.keys(SHAPE_IDS);
