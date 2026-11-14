// Presets (docs/fable-consult-3-panel.md, sections 2 and 3). A preset is a partial object over
// *look* keys, applied on top of the defaults; rig keys (fit to the avatar, palette) and local keys
// are never touched. Which preset is active and whether it was changed are always derived by
// comparing values, so they cannot go stale after a sync or an import.

import { defaults, Params } from './params';
import { scopeOf } from './panel-layout';

export type Values = Record<string, Record<string, unknown>>;

export interface Preset {
  id: string;
  name: string;
  description?: string;
  values: Values;
  builtin?: boolean;
}

const D = defaults as unknown as Values;

/** Every params path as "section.key". */
export const PATHS: string[] = Object.entries(D).flatMap(([s, o]) => Object.keys(o).map((k) => `${s}.${k}`));
export const LOOK_PATHS = PATHS.filter((p) => scopeOf(p) === 'look');

export function getPath(p: Params | Values, path: string): unknown {
  const [s, k] = path.split('.');
  return (p as Values)[s]?.[k];
}
export function setPath(p: Params | Values, path: string, v: unknown) {
  const [s, k] = path.split('.');
  const o = p as Values;
  (o[s] ??= {})[k] = v;
}

export function same(a: unknown, b: unknown) {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

/** The value a look key has under this preset (the default where the preset says nothing). */
export function presetValue(pr: Preset | undefined, path: string): unknown {
  const v = pr ? getPath(pr.values, path) : undefined;
  const d = getPath(D, path);
  return v !== undefined && typeof v === typeof d ? v : d;
}

/** Look keys that differ from the preset. */
export function isDirty(p: Params, pr: Preset | undefined) {
  return LOOK_PATHS.some((path) => !same(getPath(p, path), presetValue(pr, path)));
}

/** Set every look key to the preset's value (defaults where it is silent). */
export function applyPreset(p: Params, pr: Preset | undefined) {
  for (const path of LOOK_PATHS) setPath(p, path, structuredClone(presetValue(pr, path)));
}

/** The current look values as a diff against the defaults. */
export function lookDiff(p: Params): Values {
  const out: Values = {};
  for (const path of LOOK_PATHS) {
    const v = getPath(p, path);
    if (!same(v, getPath(D, path))) setPath(out, path, v);
  }
  return out;
}

export const BUILTIN_PRESETS: Preset[] = ([
  { id: 'default', name: 'Sprout', description: 'The standard look.', values: {} },
  {
    id: 'calm', name: 'Calm garden',
    description: 'Slow growth, long fades, soft even glow. For ballads and talk segments.',
    values: {
      look: { themeFrom: 'preset' },
      growth: { secondsToFull: 6, fadeAfter: 6, fadeSeconds: 5, restBrightness: 0.7, witherDepth: 0.3, witherSeconds: 1.5,
        twigFadeSeconds: 1.2, regrowSpeed: 0.8 },
      response: { release: 3, brightness: 0.45, variety: 0.3 },
      plants: { lift: 0.1, wildness: 0.3 },
      halo: { idleSpeed: 5, singSpeed: 40, sproutRate: 2, sproutCurl: 1.4, sproutGrow: 1.0 },
      glow: { strength: 1.3, radius: 2.4, base: 0.4, levelGain: 0.5, onsetGain: 0.3, softGlow: 0.8 },
      motion: { swayDeg: 6, kickDeg: 3, springiness: 0.3, flutterDeg: 10, speed: 0.7 },
      commit: { duration: 1.5, impact: 0.5, shockRing: false, spinTurns: 0.5, plunge: 0.2, syncToOnset: false },
    },
  },
  {
    id: 'ivy', name: 'Lush ivy',
    description: 'Dense, overgrown canopy and a long leafy halo vine. Glow held back so the detail shows.',
    values: {
      growth: { branching: 0.95, reach: 1.1, spread: 1.3, flatten: 0.45, secondsToFull: 4.5, fadeAfter: 8, fadeSeconds: 4,
        restBrightness: 0.65, witherDepth: 0.3 },
      look: { themeFrom: 'preset', theme: 'leaves', density: 0.85, decoSize: 1.5, naturalTint: 0.6, variety: 0.8, depthShade: 0.8, blossoms: 0.4,
        decoGlow: 0.12 },
      plants: { wildness: 0.7, overlap: 0.8, clearance: 0.03, taper: 0.55, lift: 0.05, maxNodes: 3600 },
      halo: { origins: 2, tailDeg: 540, tailFade: 0.3, sproutRate: 6, sproutLength: 16, alwaysLeaves: 0.7, wander: 0.14 },
      glow: { strength: 1.2, wide: 0.5, crowd: 1.1, inkMask: 0.85 },
      motion: { flutterDeg: 18, twigs: 1.3 },
      commit: { burst: 60 },
    },
  },
  {
    id: 'winter', name: 'Winter branches',
    description: 'Bare, fine twigs with wide cold haze. Sparse and quick to wither.',
    values: {
      growth: { branching: 0.25, spread: 0.7, flatten: 0.35, secondsToFull: 3, restBrightness: 0.4, fadeAfter: 2,
        fadeSeconds: 3.5, witherDepth: 0.7 },
      look: { themeFrom: 'preset', theme: 'branches', density: 0.15, decoSize: 1.0, naturalTint: 0.1, variety: 0.35, depthShade: 0.4, blossoms: 0 },
      plants: { taper: 0.8, wildness: 0.6, lift: 0.35, clearance: 0.07, overlap: 0.25 },
      response: { effortWidth: 0.5 },
      halo: { alwaysLeaves: 0.1, sproutRate: 1.5, sproutLength: 8, sproutCurl: 0.4, tailDeg: 220 },
      glow: { strength: 1.9, radius: 2.6, wide: 1.2, base: 0.2, crowd: 0.4, knee: 1.2, softGlow: 0.7 },
      motion: { swayDeg: 5, flutterDeg: 0 },
      commit: { burst: 12, impact: 1.2 },
    },
  },
  {
    id: 'festive', name: 'Festive wreath',
    description: 'A full wreath for the halo, natural reds and greens, sparkle on note starts.',
    values: {
      growth: { branching: 0.7, flatten: 0.4, restBrightness: 0.7, fadeAfter: 5 },
      look: { themeFrom: 'preset', theme: 'wreath', density: 0.8, decoSize: 2.2, naturalTint: 0.9, decoGlow: 0.35, variety: 0.7 },
      plants: { lift: 0.3 },
      halo: { origins: 2, tailDeg: 720, tailFade: 0.2, alwaysLeaves: 0.9, idleSpeed: 12, sproutLength: 7, sproutCurl: 0.5,
        wander: 0.04, ringWidth: 0.014, vineWidth: 0.01 },
      glow: { strength: 2.0, base: 0.45, onsetGain: 1.2, pitchShine: 0.9, crowd: 0.9 },
      motion: { kickDeg: 8 },
      commit: { burst: 70, spinTurns: 1.75, syncToOnset: true },
    },
  },
  {
    id: 'stage', name: 'Stage',
    description: 'Fast and punchy: trees shoot up and clear quickly, strong flashes, big motion.',
    values: {
      growth: { secondsToFull: 1.8, fadeAfter: 1.5, fadeSeconds: 1.2, restBrightness: 0.4, branching: 0.7, spread: 1.4,
        witherOnPitchDip: true, witherDepth: 0.7, witherSeconds: 0.4, regrowSpeed: 2.5 },
      response: { phraseGap: 0.6, release: 0.7, brightness: 1, effortWidth: 1.5, pitchSteer: 0.8, variety: 0.8 },
      look: { themeFrom: 'preset', blossoms: 1 },
      halo: { origins: 3, idleSpeed: 20, singSpeed: 160, tailDeg: 200, sproutRate: 8, sproutLength: 16, sproutGrow: 0.3,
        spawnSeconds: 0.5 },
      glow: { strength: 2.4, base: 0.2, levelGain: 1.6, onsetGain: 1.8, pitchShine: 1.0, front: 1.8, knee: 1.2 },
      transitions: { liveEndSeconds: 0.4, pruneSeconds: 0.9 },
      motion: { swayDeg: 12, kickDeg: 12, springiness: 0.7, speed: 1.4, shiverDeg: 5 },
      commit: { duration: 0.65, impact: 1.8, burst: 70, spinTurns: 1.5, plunge: 0.4, syncToOnset: true, syncWindow: 0.15 },
    },
  },
  {
    id: 'minimal', name: 'Minimal',
    description: 'Small, quiet, low glow. Stays out of the way of chat and game capture; lightest on the GPU.',
    values: {
      growth: { branching: 0.3, reach: 0.8, restBrightness: 0.35, fadeAfter: 1.5, fadeSeconds: 2 },
      response: { brightness: 0.5, effortWidth: 0.5 },
      look: { themeFrom: 'preset', density: 0.3, decoSize: 1.2, decoGlow: 0.1, blossoms: 0.3, naturalTint: 0.2 },
      plants: { wildness: 0.25, maxNodes: 1500 },
      halo: { sproutRate: 1.5, sproutLength: 7, alwaysLeaves: 0.2, tailDeg: 180, wander: 0.04 },
      glow: { strength: 0.8, radius: 1.2, wide: 0.3, base: 0.15, levelGain: 0.5, onsetGain: 0.3, pitchShine: 0.2, front: 0.4 },
      motion: { swayDeg: 4, kickDeg: 3, flutterDeg: 8, shiverDeg: 1.5 },
      commit: { duration: 0.7, impact: 0.4, burst: 10, shockRing: false, spinTurns: 0.5, syncToOnset: false },
    },
  },
  {
    id: 'bramble', name: 'Bramble',
    description: 'Drooping, pointed, thorny. Thorns and thickness follow vocal effort.',
    values: {
      growth: { branching: 0.5, spread: 1.6, flatten: 0.7 },
      look: { themeFrom: 'preset', theme: 'thorns', thornEffort: 2, density: 0.45, decoSize: 1.6, naturalTint: 0.5, depthShade: 0.8 },
      plants: { lift: -0.25, taper: 0.9, wildness: 0.8, softDroop: 1.6 },
      response: { effortWidth: 1.4, pitchSteer: 0.7 },
      halo: { sproutCurl: 0.3, sproutLength: 14, wander: 0.12, alwaysLeaves: 0.5 },
      glow: { strength: 1.4, front: 1.4, onsetGain: 1.2 },
      motion: { twigs: 0.6, flutterDeg: 6, springiness: 0.35 },
      commit: { impact: 1.6, burst: 15, plunge: 0.4 },
    },
  },
] as Preset[]).map((p) => ({ ...p, builtin: true }));

// ---- Storage ---------------------------------------------------------------------------------------

const KEY = 'sprout.viewer.presets.v1';

export interface PresetStore {
  active: string | null;
  user: Preset[];
  /** Look diff saved when switching away from unsaved tweaks. */
  stash?: Values;
}

export function loadStore(): PresetStore {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (s && Array.isArray(s.user)) return { active: s.active ?? null, user: s.user, stash: s.stash };
  } catch {
    /* ignore */
  }
  return { active: 'default', user: [] };
}

export function saveStore(s: PresetStore) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'preset';
