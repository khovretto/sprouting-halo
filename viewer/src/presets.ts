// Presets in three independent kinds, each with its own built-ins, saved presets and revert:
//
//  - visual:     what it looks like (tree shape, leaves, colour tint, glow look, halo look)
//  - reactivity: how it answers the voice (growth timing, withering, response, motion,
//                sound-driven glow, halo speeds, the commit animation)
//  - testing:    the fake singer and preview switches (this viewer only, never synced)
//
// Rig keys (fit to the avatar, the colour palette, connection) belong to no preset. A preset is a
// partial object over its kind's keys, applied on top of the defaults. Which preset is active and
// whether it was changed are always derived by comparing values, so they cannot go stale after a
// sync or an import.

import { defaults, Params } from './params';
import { scopeOf } from './panel-layout';

export type Values = Record<string, Record<string, unknown>>;
export type Kind = 'visual' | 'reactivity' | 'testing';
export const KINDS: Kind[] = ['visual', 'reactivity', 'testing'];
export const KIND_TITLES: Record<Kind, string> = { visual: 'Visual', reactivity: 'Reactivity', testing: 'Testing' };

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

/** Keys that respond to the voice (the reactivity kind). */
const REACTIVE = new Set([
  'growth.newTreeEachPhrase', 'growth.secondsToFull', 'growth.restBrightness', 'growth.fadeAfter', 'growth.fadeSeconds',
  'growth.witherOnPause', 'growth.witherOnPitchDip', 'growth.witherDipSemitones', 'growth.witherDepth',
  'growth.witherSeconds', 'growth.twigFadeSeconds', 'growth.regrowSpeed',
  'glow.levelGain', 'glow.onsetGain', 'glow.pitchShine', 'glow.softGlow', 'glow.front',
  'halo.idleSpeed', 'halo.singSpeed', 'halo.sproutRate', 'halo.sproutGrow', 'halo.spawnSeconds',
  'plants.softDroop', 'plants.moodShaping', 'look.blossoms', 'look.blossomHold', 'look.thornEffort',
]);
const REACTIVE_SECTIONS = new Set(['response', 'motion', 'commit', 'transitions']);
/** Preview keys a testing preset may set (never synced; other local keys stay as they are). */
const TESTING = new Set([
  'scene.layers', 'scene.timeScale', 'scene.backdrop', 'scene.showAvatar', 'scene.showGuides', 'scene.showScope',
  'scene.scopeLayer', 'scene.scopeSeconds',
]);

/** Which kind of preset owns this key (null: rig and connection keys, never in a preset). */
export function kindOf(path: string): Kind | null {
  if (path.startsWith('fake.') || TESTING.has(path)) return 'testing';
  if (scopeOf(path) !== 'look') return null;
  if (REACTIVE.has(path) || REACTIVE_SECTIONS.has(path.split('.')[0])) return 'reactivity';
  return 'visual';
}
export const KIND_PATHS: Record<Kind, string[]> = {
  visual: PATHS.filter((p) => kindOf(p) === 'visual'),
  reactivity: PATHS.filter((p) => kindOf(p) === 'reactivity'),
  testing: PATHS.filter((p) => kindOf(p) === 'testing'),
};

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

/** The value a key has under this preset (the default where the preset says nothing). */
export function presetValue(pr: Preset | undefined, path: string): unknown {
  const v = pr ? getPath(pr.values, path) : undefined;
  const d = getPath(D, path);
  return v !== undefined && typeof v === typeof d ? v : d;
}

/** Keys of this kind that differ from the preset. */
export function isDirty(p: Params, pr: Preset | undefined, kind: Kind) {
  return KIND_PATHS[kind].some((path) => !same(getPath(p, path), presetValue(pr, path)));
}

/** Set every key of this kind to the preset's value (defaults where it is silent). */
export function applyPreset(p: Params, pr: Preset | undefined, kind: Kind) {
  for (const path of KIND_PATHS[kind]) setPath(p, path, structuredClone(presetValue(pr, path)));
}

/** The current values of this kind as a diff against the defaults. */
export function diffOf(p: Params | Values, kind: Kind): Values {
  const out: Values = {};
  for (const path of KIND_PATHS[kind]) {
    const v = getPath(p, path);
    if (v !== undefined && !same(v, getPath(D, path))) setPath(out, path, v);
  }
  return out;
}

const built = (list: Preset[]) => list.map((p) => ({ ...p, builtin: true }));

export const BUILTINS: Record<Kind, Preset[]> = {
  visual: built([
    { id: 'default', name: 'Sprout', description: 'The standard look: leafy ivy canopy, even glow.', values: {} },
    {
      id: 'ivy', name: 'Lush ivy', description: 'Dense, overgrown canopy and a long leafy halo vine. Glow held back so the detail shows.',
      values: {
        colLeaf: { takeMix: 0.4 },
        growth: { branching: 0.95, reach: 1.1, spread: 1.3, flatten: 0.45 },
        look: { theme: 'leaves', density: 0.85, decoSize: 1.5, variety: 0.8, depthShade: 0.8, decoGlow: 0.12 },
        plants: { wildness: 0.7, overlap: 0.8, clearance: 0.03, taper: 0.55, lift: 0.05, maxNodes: 3600 },
        halo: { origins: 2, tailDeg: 540, tailFade: 0.3, sproutLength: 16, alwaysLeaves: 0.7, wander: 0.14 },
        glow: { strength: 1.2, wide: 0.5, crowd: 1.1, inkMask: 0.85 },
      },
    },
    {
      id: 'winter', name: 'Winter branches', description: 'Bare, fine twigs with a wide, cold, pale-blue haze.',
      values: {
        colLeaf: { takeMix: 0.9 },
        growth: { branching: 0.25, spread: 0.7, flatten: 0.35 },
        look: { theme: 'branches', density: 0.15, decoSize: 1.0, variety: 0.35, depthShade: 0.4, tint: '#bfe3ff', tintAmount: 0.35 },
        plants: { taper: 0.8, wildness: 0.6, lift: 0.35, clearance: 0.07, overlap: 0.25 },
        halo: { alwaysLeaves: 0.1, sproutLength: 8, sproutCurl: 0.4, tailDeg: 220 },
        glow: { strength: 1.9, radius: 2.6, wide: 1.2, base: 0.2, crowd: 0.4, knee: 1.2 },
      },
    },
    {
      id: 'festive', name: 'Festive wreath', description: 'A full wreath for the halo, natural reds and greens.',
      values: {
        colLeaf: { takeMix: 0.1 },
        colAccent: { takeMix: 0.05 },
        growth: { branching: 0.7, flatten: 0.4 },
        look: { theme: 'wreath', density: 0.8, decoSize: 2.2, decoGlow: 0.35, variety: 0.7 },
        plants: { lift: 0.3 },
        halo: { origins: 2, tailDeg: 720, tailFade: 0.2, alwaysLeaves: 0.9, sproutLength: 7, sproutCurl: 0.5, wander: 0.04, ringWidth: 0.014, vineWidth: 0.01 },
        glow: { strength: 2.0, base: 0.45, crowd: 0.9 },
      },
    },
    {
      id: 'bramble', name: 'Red bramble', description: 'A dense, drooping thicket of thorns in deep red, with little glow.',
      values: {
        colLeaf: { takeMix: 0.95 },
        growth: { branching: 0.95, spread: 1.5, flatten: 0.6 },
        look: { theme: 'thorns', density: 0.95, decoSize: 1.5, variety: 0.8, depthShade: 0.85, decoGlow: 0.05, tint: '#c0142c', tintAmount: 0.88 },
        plants: { lift: -0.2, taper: 0.85, wildness: 0.75, clearance: 0.03, overlap: 0.7, maxNodes: 3400 },
        halo: { sproutCurl: 0.3, sproutLength: 14, wander: 0.12, alwaysLeaves: 0.6 },
        glow: { strength: 0.75, radius: 1.3, wide: 0.35, base: 0.12, crowd: 1.1, inkMask: 0.85 },
      },
    },
    {
      id: 'minimal', name: 'Minimal', description: 'Small and quiet with low glow. Stays out of the way; lightest on the GPU.',
      values: {
        colLeaf: { takeMix: 0.8 },
        growth: { branching: 0.3, reach: 0.8 },
        look: { density: 0.3, decoSize: 1.2, decoGlow: 0.1 },
        plants: { wildness: 0.25, maxNodes: 1500 },
        halo: { sproutLength: 7, alwaysLeaves: 0.2, tailDeg: 180, wander: 0.04 },
        glow: { strength: 0.8, radius: 1.2, wide: 0.3, base: 0.15 },
      },
    },
    {
      id: 'neon', name: 'Neon stage', description: 'Bright, wide-arching trees and a strong glow for big moments.',
      values: {
        colLeaf: { takeMix: 0.9 },
        growth: { branching: 0.7, spread: 1.4 },
        halo: { origins: 3, tailDeg: 200 },
        glow: { strength: 2.4, base: 0.2, knee: 1.2 },
      },
    },
  ]),
  reactivity: built([
    { id: 'default', name: 'Responsive', description: 'The standard response: grows in about 3.5 s of singing, sways and pushes with your notes.', values: {} },
    {
      id: 'calm', name: 'Calm (ballad)', description: 'Slow growth, long fades, gentle motion and soft glow. For ballads and talk segments.',
      values: {
        growth: { secondsToFull: 6, fadeAfter: 6, fadeSeconds: 5, restBrightness: 0.7, witherDepth: 0.3, witherSeconds: 1.5, twigFadeSeconds: 1.2, regrowSpeed: 0.8 },
        response: { release: 3, brightness: 0.45, variety: 0.3 },
        halo: { idleSpeed: 5, singSpeed: 40, sproutRate: 2, sproutGrow: 1.0 },
        glow: { levelGain: 0.5, onsetGain: 0.3, softGlow: 0.8 },
        motion: { swayDeg: 6, kickDeg: 3, springiness: 0.3, flutterDeg: 10, speed: 0.7 },
        commit: { duration: 1.5, impact: 0.5, shockRing: false, spinTurns: 0.5, plunge: 0.2, syncToOnset: false },
      },
    },
    {
      id: 'stage', name: 'Punchy (stage)', description: 'Fast and punchy: trees shoot up and clear quickly, strong flashes, big pushes.',
      values: {
        growth: { secondsToFull: 1.8, fadeAfter: 1.5, fadeSeconds: 1.2, restBrightness: 0.4, witherOnPitchDip: true, witherDepth: 0.7, witherSeconds: 0.4, regrowSpeed: 2.5 },
        response: { phraseGap: 0.6, release: 0.7, brightness: 1, effortWidth: 1.5, pitchSteer: 0.8, variety: 0.8 },
        look: { blossoms: 1 },
        halo: { idleSpeed: 20, singSpeed: 160, sproutRate: 8, sproutGrow: 0.3, spawnSeconds: 0.5 },
        glow: { levelGain: 1.6, onsetGain: 1.8, pitchShine: 1.0, front: 1.8 },
        motion: { swayDeg: 12, kickDeg: 12, springiness: 0.7, speed: 1.4, shiverDeg: 5 },
        transitions: { liveEndSeconds: 0.4, pruneSeconds: 0.9 },
        commit: { duration: 0.65, impact: 1.8, burst: 70, spinTurns: 1.5, plunge: 0.4, syncToOnset: true, syncWindow: 0.15 },
      },
    },
    {
      id: 'subtle', name: 'Subtle', description: 'Small reactions: little brightness change, light motion, a quiet planting.',
      values: {
        growth: { restBrightness: 0.35, fadeAfter: 1.5, fadeSeconds: 2 },
        response: { brightness: 0.5, effortWidth: 0.5 },
        halo: { sproutRate: 1.5 },
        glow: { levelGain: 0.5, onsetGain: 0.3, pitchShine: 0.2, front: 0.4 },
        motion: { swayDeg: 4, kickDeg: 3, flutterDeg: 8, shiverDeg: 1.5 },
        commit: { duration: 0.7, impact: 0.4, burst: 10, shockRing: false, spinTurns: 0.5, syncToOnset: false },
      },
    },
    {
      id: 'vibrato', name: 'Vibrato-sensitive', description: 'Light vibrato already makes twigs and leaves shimmer; soft singing glows wider.',
      values: {
        motion: { shiverDeg: 6, shiverSensitivity: 2, flutterDeg: 18 },
        glow: { softGlow: 0.8 },
      },
    },
  ]),
  testing: built([
    { id: 'default', name: 'Normal song', description: 'Fake singer: phrases of 2 to 6 s, short pauses, one live track recording, two takes.', values: {} },
    {
      id: 'ballad', name: 'Ballad', description: 'Long phrases and notes (lots of vibrato), longer pauses.',
      values: { fake: { phraseMin: 4, phraseMax: 9, gapMin: 1, gapMax: 2.5, highNotes: 0.1, noteMax: 3.5 } },
    },
    {
      id: 'fast', name: 'Fast pop', description: 'Short phrases, short pauses, more high notes.',
      values: { fake: { phraseMin: 1, phraseMax: 3, gapMin: 0.2, gapMax: 0.6, highNotes: 0.35 } },
    },
    { id: 'six', name: 'Six takes', description: 'A full scene: one live halo and six take trees.', values: { scene: { layers: 7 } } },
    { id: 'idle', name: 'Not recording', description: 'The live track is not recording: the small resting halo on the head.', values: { fake: { recording: false } } },
    { id: 'duet', name: 'Two live tracks', description: 'Two live tracks at once: nested halos.', values: { fake: { liveTracks: 2 } } },
    {
      id: 'study', name: 'Slow-motion study', description: 'Quarter speed with the voice scope open, to study how the voice is read.',
      values: { scene: { timeScale: 0.25, showScope: true } },
    },
  ]),
};

// ---- Storage ---------------------------------------------------------------------------------------

const KEY = 'sprout.viewer.presets.v2';
const OLD_KEY = 'sprout.viewer.presets.v1';

export interface KindStore {
  active: string | null;
  user: Preset[];
  /** Diff saved when switching away from unsaved tweaks. */
  stash?: Values;
}
export type PresetStore = Record<Kind, KindStore>;

const empty = (): PresetStore => ({
  visual: { active: 'default', user: [] },
  reactivity: { active: 'default', user: [] },
  testing: { active: 'default', user: [] },
});

export function loadStore(): PresetStore {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (s && s.visual && s.reactivity && s.testing) return s;
    // v1 (one kind of preset): split each saved preset into a visual and a reactivity preset.
    const old = JSON.parse(localStorage.getItem(OLD_KEY) ?? 'null');
    const st = empty();
    if (old && Array.isArray(old.user)) {
      for (const pr of old.user as Preset[])
        for (const k of ['visual', 'reactivity'] as Kind[]) {
          const values = diffOf(pr.values, k);
          if (Object.keys(values).length) st[k].user.push({ id: pr.id, name: pr.name, values });
        }
    }
    return st;
  } catch {
    return empty();
  }
}

export function saveStore(s: PresetStore) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export const STORE_KEY = KEY;
export const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'preset';
